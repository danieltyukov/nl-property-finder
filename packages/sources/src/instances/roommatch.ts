import type { ZigPortalDef } from '../generic/zig.js';

/**
 * RoomMatch, the student housing portal where DUWO publishes its Delft offer
 * (duwo.nl links there through ROOM). Checked on 2026-09-24: 120 objects,
 * Delft 33, Wageningen 34, Amsterdam 19, Groningen 10; almost all
 * "inschrijfduur" (waiting time), a few "hospiteren" and one "reactiedatum".
 * Detail pages live under /aanbod/studentenwoningen/details/<urlKey>.
 * The rooms field holds a constant here, so it is ignored.
 */
export const roommatch: ZigPortalDef = {
  id: 'roommatch',
  name: 'RoomMatch (DUWO and other student housing)',
  homepage: 'https://www.roommatch.nl',
  detailPath: '/aanbod/studentenwoningen/details/',
  regions: ['delft', 'den haag', 'leiden', 'amsterdam', 'amstelveen', 'haarlemmermeer', 'haarlem', 'wageningen', 'groningen', 'deventer'],
  registration: 'ROOM account (one login for RoomMatch and SSHxl), EUR 35 one-time, valid 8 years',
  maxActiveReactions: 5,
  publishers: ['DUWO'],
  roomsField: false,
  intervalSec: 60,
};
