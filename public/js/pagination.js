document.addEventListener('DOMContentLoaded', () => {
  const paginations = Array.from(document.querySelectorAll('.pagination, .table-pagination'));
  if (paginations.length === 0) return;

  const getMiddleWindowSize = () => {
    if (window.innerWidth <= 480) return 1;
    if (window.innerWidth <= 768) return 2;
    return 3;
  };

  const getVisiblePages = (current, total) => {
    if (total <= 5) return new Set(Array.from({ length: total }, (_, i) => i + 1));

    const middleWindow = getMiddleWindowSize();
    let start = Math.max(2, current - Math.floor(middleWindow / 2));
    let end = Math.min(total - 1, start + middleWindow - 1);

    if (end >= total) {
      end = total - 1;
      start = Math.max(2, end - middleWindow + 1);
    }

    const pages = new Set([1, total]);
    for (let i = start; i <= end; i += 1) pages.add(i);
    return pages;
  };

  const renderPagination = (container) => {
    const pageItems = Array.from(container.querySelectorAll('.page-link, .pagination-btn'));
    const numberedItems = pageItems.filter((item) => /^\d+$/.test(item.textContent.trim()));
    if (numberedItems.length <= 1) return;

    const currentElement = numberedItems.find((item) => item.classList.contains('active'));
    const currentPage = currentElement ? Number(currentElement.textContent.trim()) : 1;
    const totalPages = Math.max(...numberedItems.map((item) => Number(item.textContent.trim())));
    const visiblePages = getVisiblePages(currentPage, totalPages);

    container.querySelectorAll('.pagination-ellipsis').forEach((node) => node.remove());

    numberedItems.forEach((item) => {
      const pageNumber = Number(item.textContent.trim());
      item.style.display = visiblePages.has(pageNumber) ? '' : 'none';
    });

    const visibleItems = numberedItems.filter((item) => item.style.display !== 'none');
    for (let i = 0; i < visibleItems.length - 1; i += 1) {
      const currentNumber = Number(visibleItems[i].textContent.trim());
      const nextNumber = Number(visibleItems[i + 1].textContent.trim());
      if (nextNumber - currentNumber > 1) {
        const ellipsis = document.createElement('span');
        const baseClass = visibleItems[i].className.replace(/\bactive\b/g, '').trim();
        ellipsis.className = `${baseClass} pagination-ellipsis`;
        ellipsis.textContent = '…';
        visibleItems[i].parentNode.insertBefore(ellipsis, visibleItems[i + 1]);
      }
    }
  };

  const apply = () => paginations.forEach(renderPagination);
  apply();
  window.addEventListener('resize', apply);
});
