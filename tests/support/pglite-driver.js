'use strict';

/**
 * Драйвер Sequelize поверх PGlite (Postgres, собранный в WASM).
 *
 * Зачем: в проекте один диалект — postgres, но для тестов не нужен ни сервер,
 * ни docker. Подменяем только модуль `pg`, сам Sequelize остаётся настоящим:
 * настоящий queryGenerator, настоящие миграции, настоящие SQL-ошибки.
 *
 * Ограничение: один инстанс PGlite = одно соединение, поэтому пул в тестах
 * должен быть равен 1 и запросы не должны идти параллельно.
 */

const { PGlite } = require('@electric-sql/pglite');
const pgTypes = require('pg').types;
const EventEmitter = require('events');

// Системные каталоги PGlite отдаёт нестандартным списком полей (name = "name"),
// из-за чего Sequelize не находит колонку table_name. Переименовываем на лету.
const COLUMN_ALIASES = { name: 'table_name' };

// Внутренний тип name (oid 19) PGlite отдаёт как Buffer — приводим к строке
const OID_NAME = 19;


// PGlite всегда отдаёт массивы как JS-массивы, а Sequelize ждёт строку
// в формате Postgres ({a,b}) и разбирает её сам (fromArray) при интроспекции
// индексов. Поэтому массивы сериализуем обратно в текст.
const ARRAY_OIDS = new Set([
  199, 143, 1000, 1001, 1003, 1005, 1006, 1007, 1009, 1010, 1011, 1012, 1013,
  1014, 1015, 1016, 1017, 1018, 1019, 1020, 1021, 1022, 1115, 1182, 1183,
  1185, 1187, 1223, 1270, 3807
]);

function escapeArrayElement(value) {
  if (value === null || value === undefined) return 'NULL';
  const text = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${text}"`;
}

function toPgArrayLiteral(values) {
  return `{${values.map(escapeArrayElement).join(',')}}`;
}

async function createDriver(options = {}) {
  const pg = await PGlite.create(options.dataDir ? { dataDir: options.dataDir } : undefined);

  class Client extends EventEmitter {
    constructor(config) {
      super();
      this.config = config;
      this.connection = new EventEmitter();
      this._invalid = false;
      this.processID = 1;
      this.secretKey = 1;
      // Sequelize читает это поле при connect
      Promise.resolve().then(() => {
        this.connection.emit('parameterStatus', { parameterName: 'server_version', parameterValue: '16.0' });
        this.connection.emit('parameterStatus', { parameterName: 'standard_conforming_strings', parameterValue: 'on' });
      });
    }

    async connect(callback) {
      if (callback) callback(null);
    }

    query(sqlOrConfig, valuesOrCallback, maybeCallback) {
      const config = typeof sqlOrConfig === 'string' ? { text: sqlOrConfig, values: valuesOrCallback } : sqlOrConfig;
      const callback = typeof valuesOrCallback === 'function'
        ? valuesOrCallback
        : (typeof maybeCallback === 'function' ? maybeCallback : null);

      const run = async () => {
        // Несколько запросов через `;` и пустые строки PGlite не принимает в одном вызове
        if (!config.text || !config.text.trim()) {
          return { rows: [], fields: [], rowCount: 0, command: '' };
        }
        const hasValues = Array.isArray(config.values) && config.values.length > 0;
        const result = hasValues
          ? await pg.query(config.text, config.values)
          : await pg.exec(config.text);
        const results = Array.isArray(result) ? result : [result];
        const rows = results.reduce((acc, item) => acc.concat(item.rows || []), []);
        const fields = results.reduce((acc, item) => acc.concat(item.fields || []), []);
        for (const result of results) {
          const arrayFields = (result.fields || []).filter((field) => ARRAY_OIDS.has(field.dataTypeID));
          if (!arrayFields.length) continue;
          for (const row of result.rows || []) {
            for (const field of arrayFields) {
              const value = row[field.name];
              if (Array.isArray(value)) row[field.name] = toPgArrayLiteral(value);
            }
          }
        }

        // Иногда fields пустые: восстанавливаем имена полей из первой строки
        let fieldNames = fields.map((field) => field.name);
        if (!fieldNames.length && rows[0]) fieldNames = Object.keys(rows[0]);

        // Приводим внутренние типы PGlite (oid 19 = name) к обычным строкам
        const nameFields = new Set();
        for (const result of results) {
          for (const field of result.fields || []) {
            if (field.dataTypeID === OID_NAME) nameFields.add(field.name);
          }
        }
        if (nameFields.size) {
          for (const result of results) {
            for (const row of result.rows || []) {
              for (const field of nameFields) {
                const value = row[field];
                if (Buffer.isBuffer(value)) row[field] = value.toString('utf8');
                else if (typeof value === 'string' && value.startsWith('\\x')) {
                  row[field] = Buffer.from(value.slice(2), 'hex').toString('utf8');
                }
              }
            }
          }
        }

        // rowCount — сумма по всем запросам: Sequelize выполняет составные
        // команды (функция + SELECT + DROP) одним вызовом и ждёт общее число.
        const affected = results.reduce((sum, item) => sum + (item.affectedRows || 0), 0);
        const last = results[results.length - 1] || {};
        return {
          rows,
          fields: fieldNames.map((rawName) => {
            const name = COLUMN_ALIASES[rawName] || rawName;
            const sample = rows.find((row) => row[rawName] !== undefined)?.[rawName];
            let dataTypeID = 25;
            if (typeof sample === 'number') dataTypeID = 23;
            else if (typeof sample === 'boolean') dataTypeID = 16;
            else if (sample instanceof Date) dataTypeID = 1184;
            return { name, dataTypeID };
          }),
          rowCount: affected || rows.length,
          command: last.command
        };
      };

      if (callback) {
        run().then((result) => callback(null, result), (error) => callback(error));
        return undefined;
      }
      return run();
    }

    end(callback) {
      if (callback) callback(null);
      return Promise.resolve();
    }
  }

  return {
    Client,
    types: pgTypes,
    defaults: {},
    Database: function Database() {},
    Pool: function Pool() {}
  };
}

module.exports = { createDriver };
