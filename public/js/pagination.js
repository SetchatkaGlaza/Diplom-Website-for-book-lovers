document.addEventListener('DOMContentLoaded', () => {
  const paginations = Array.from(document.querySelectorAll('.pagination, .table-pagination'));
  if (paginations.length === 0) return;

  const getMaxVisiblePages = () => {
    if (window.innerWidth <= 480) return 3;
    if (window.innerWidth <= 768) return 4;
    return 5;
  };

  const buildWindow = (current, total, maxVisible) => {
    if (total <= maxVisible) return Array.from({ length: total }, (_, index) => index + 1);

    const side = Math.floor(maxVisible / 2);
    let start = current - side;
    let end = current + side;

    if (maxVisible % 2 === 0) end -= 1;

    if (start < 1) {
      end += 1 - start;
      start = 1;
    }

    if (end > total) {
      start -= end - total;
      end = total;
    }

    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  };

  const renderPagination = (container) => {
    const pageItems = Array.from(container.querySelectorAll('.page-link, .pagination-btn'));
    const numberedItems = pageItems.filter((item) => /^\d+$/.test(item.textContent.trim()));

    if (numberedItems.length <= 1) return;

    const currentElement = numberedItems.find((item) => item.classList.contains('active'));
    const currentPage = currentElement ? Number(currentElement.textContent.trim()) : 1;
    const totalPages = Math.max(...numberedItems.map((item) => Number(item.textContent.trim())));
    const allowedPages = new Set(buildWindow(currentPage, totalPages, getMaxVisiblePages()));

    container.querySelectorAll('.pagination-ellipsis').forEach((node) => node.remove());

    numberedItems.forEach((item) => {
      const pageNumber = Number(item.textContent.trim());
      item.style.display = allowedPages.has(pageNumber) ? '' : 'none';
    });

    const firstVisible = numberedItems.find((item) => item.style.display !== 'none');
    const lastVisible = [...numberedItems].reverse().find((item) => item.style.display !== 'none');
    if (!firstVisible || !lastVisible) return;

    const addEllipsis = (target, where) => {
      const ellipsis = document.createElement('span');
      const baseClass = target.className.replace(/\bactive\b/g, '').trim();
      ellipsis.className = `${baseClass} pagination-ellipsis`;
      ellipsis.textContent = '…';
      if (where === 'before') target.parentNode.insertBefore(ellipsis, target);
      else target.parentNode.insertBefore(ellipsis, target.nextSibling);
    };

    if (Number(firstVisible.textContent.trim()) > 1) addEllipsis(firstVisible, 'before');
    if (Number(lastVisible.textContent.trim()) < totalPages) addEllipsis(lastVisible, 'after');
  };

  const apply = () => paginations.forEach(renderPagination);
  apply();
  window.addEventListener('resize', apply);
});
