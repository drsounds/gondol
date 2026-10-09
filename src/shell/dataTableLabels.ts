/**
 * On phone widths every `.data-table` renders as Spotify-style list rows (see "Data tables as
 * list rows" in src/styles.css): the name on top and the other cells on one muted line below,
 * with the column headers hidden. This annotates each body/footer cell so the stylesheet can do
 * that without per-table markup:
 *
 * - `data-label`: the column's header text, shown in front of amounts and checkboxes so
 *   "1 200 kr" still says what it is.
 * - `data-cell="title"` on the row's name (the cell marked `.data-table__title`, else the first
 *   cell), and `data-cell="1"`, `"2"`, … on the cells after it, in order, which lets entity rows
 *   show only the first couple (plus any cell marked `.data-table__keep`) like Spotify does.
 * - `data-blank` on "—" placeholder cells, which are hidden there.
 *
 * One observer covers every table in the app.
 */
export function installDataTableLabels(): () => void {
  let frame = 0;

  const set = (cell: HTMLElement, key: "label" | "cell", value: string) => {
    if (cell.dataset[key] !== value) cell.dataset[key] = value;
  };

  const annotate = () => {
    frame = 0;
    for (const table of document.querySelectorAll<HTMLTableElement>("table.data-table")) {
      const headRow = table.tHead?.rows[table.tHead.rows.length - 1];
      const headers: string[] = [];
      for (const th of headRow?.cells ?? []) {
        const text = th.textContent?.trim() ?? "";
        for (let i = 0; i < th.colSpan; i++) headers.push(text);
      }
      for (const section of [...table.tBodies, ...(table.tFoot ? [table.tFoot] : [])]) {
        for (const row of section.rows) {
          const cells = [...row.cells].filter((c) => !c.classList.contains("action-row-cell") && !c.classList.contains("track-list__index"));
          const title = cells.find((c) => c.classList.contains("data-table__title")) ?? cells[0];
          let column = 0;
          for (const cell of row.cells) {
            const text = headers[column] ?? "";
            if (cell.colSpan === 1 && text) set(cell, "label", text);
            column += cell.colSpan;
          }
          let meta = 0;
          for (const cell of cells) {
            set(cell, "cell", cell === title ? "title" : String(++meta));
            // "—" placeholders only read as a value under a column header.
            const blank = cell.textContent?.trim() === "—";
            if (blank !== (cell.dataset.blank === "")) {
              if (blank) cell.dataset.blank = "";
              else delete cell.dataset.blank;
            }
          }
        }
      }
    }
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(annotate);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  schedule();
  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
  };
}
