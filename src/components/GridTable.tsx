import { useEffect, useRef } from 'react';
import type { GridPayload } from '../lib/api/types';
import type { SaveMap } from '../features/grid/cellState';
import { stateOf } from '../features/grid/cellState';
import { isExpectedDate, type ExpectedDaysMode } from '../features/grid/completion';
import {
  cellKey,
  formatDateHeader,
  toCellView,
  type CellIndex,
  type CellKind,
} from '../features/grid/model';
import { isInSelection, singleCell, type Selection } from '../features/grid/selection';
import { SaveDot } from './Bits';

const KIND_CLASS: Record<CellKind, string> = {
  EMPTY: 'c-empty',
  WORK: 'c-work',
  WORK_NO_SHIFT: 'c-err',
  GO: 'c-go',
  BO: 'c-bo',
  OFF: 'c-off',
  NOT_WORKING: 'c-nw',
  OTHER: 'c-other',
  FOREIGN_ONLY: 'c-foreign',
};

const KIND_TITLE: Record<CellKind, string> = {
  EMPTY: 'Nije pregledano — nema zapisa u bazi i nema troška',
  WORK: 'Rad',
  WORK_NO_SHIFT: 'Označeno kao rad, ali smena nije uneta',
  GO: 'Godišnji odmor',
  BO: 'Bolovanje',
  OFF: 'Slobodan dan',
  NOT_WORKING: 'Ne radi',
  OTHER: 'Ostalo',
  FOREIGN_ONLY: 'Dan pripada prijavi drugog centra — ovde je samo za čitanje',
};

export function GridTable({
  payload,
  index,
  selection,
  saveMap,
  expectedMode,
  onSelect,
  onKeyDown,
}: {
  payload: GridPayload;
  index: CellIndex;
  selection: Selection;
  saveMap: SaveMap;
  expectedMode: ExpectedDaysMode;
  onSelect(sel: Selection): void;
  onKeyDown(e: React.KeyboardEvent): void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLTableCellElement>(null);

  // Keep the focused cell visible during keyboard navigation.
  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selection.focus.r, selection.focus.c]);

  const { employees, dates } = payload;

  /*
   * Kada period ima malo dana, tabela se razvlači na punu širinu umesto da
   * ostavi praznu belinu desno. Kod dužih perioda ostaje horizontalni skrol i
   * kompaktne kolone — gustina grida se ne žrtvuje.
   */
  const wide = dates.length > 0 && dates.length <= 12;

  return (
    <div
      className="grid-wrap"
      ref={wrapRef}
      tabIndex={0}
      role="grid"
      aria-label="Dnevna evidencija"
      onKeyDown={onKeyDown}
    >
      <table className={wide ? 'grid grid-wide' : 'grid'}>
        <thead>
          <tr>
            <th className="sticky-corner" scope="col">
              Zaposleni
            </th>
            {dates.map((d, c) => {
              const h = formatDateHeader(d);
              const expected = isExpectedDate(d, expectedMode);
              return (
                <th
                  key={d}
                  scope="col"
                  className={[
                    'date-head',
                    h.weekend ? 'weekend' : '',
                    expected ? '' : 'not-expected',
                    selection.focus.c === c ? 'col-focus' : '',
                  ].join(' ')}
                  title={expected ? undefined : 'Nije očekivan radni dan'}
                >
                  <span className="dh-day">{h.day}</span>
                  <span className="dh-date">{h.dm}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {employees.map((emp, r) => (
            <tr key={emp.employee_id} className={selection.focus.r === r ? 'row-focus' : ''}>
              <th scope="row" className="sticky-name">
                <span className="emp-name">{emp.full_name}</span>
                <span className="emp-meta">
                  {emp.employee_code && <span className="emp-code">{emp.employee_code}</span>}
                  <span className="emp-ptype">{emp.primary_payment_type_code ?? '—'}</span>
                  {emp.transport_provider_code && (
                    <span className="chip chip-transport" title="Prevoznik">
                      {emp.transport_provider_code}
                    </span>
                  )}
                  {emp.transport_required === null && (
                    <span className="chip chip-warn" title="Nema evidencije o prevozu (ni DA ni NE)">
                      prevoz?
                    </span>
                  )}
                </span>
              </th>

              {dates.map((d, c) => {
                const key = cellKey(emp.employee_id, d);
                const view = toCellView(emp.employee_id, d, index.get(key));
                const save = stateOf(saveMap, key);
                const selected = isInSelection(selection, r, c);
                const isFocus = selection.focus.r === r && selection.focus.c === c;
                const expected = isExpectedDate(d, expectedMode);
                const err = save === 'error' ? saveMap[key]?.errorMessage : undefined;

                return (
                  <td
                    key={d}
                    ref={isFocus ? focusRef : undefined}
                    className={[
                      'cell',
                      KIND_CLASS[view.kind],
                      selected ? 'selected' : '',
                      isFocus ? 'focused' : '',
                      expected ? '' : 'not-expected',
                      save === 'error' ? 'has-error' : '',
                    ].join(' ')}
                    title={err ?? KIND_TITLE[view.kind]}
                    aria-selected={selected}
                    onMouseDown={(ev) => {
                      if (ev.shiftKey) onSelect({ anchor: selection.anchor, focus: { r, c } });
                      else onSelect(singleCell(r, c));
                    }}
                    onMouseEnter={(ev) => {
                      if (ev.buttons === 1) onSelect({ anchor: selection.anchor, focus: { r, c } });
                    }}
                  >
                    <span className="cell-label">{view.label}</span>
                    <span className="cell-marks">
                      {view.hasForeignSegment && (
                        <span className="mark mark-foreign" title="Sadrži ispomoć drugog centra">
                          ⇄
                        </span>
                      )}
                      {view.hasAssistance && !view.hasForeignSegment && (
                        <span className="mark mark-assist" title="Ispomoć">
                          +
                        </span>
                      )}
                      <SaveDot state={save} />
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
