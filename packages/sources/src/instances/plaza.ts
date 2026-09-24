import type { ZigPortalDef } from '../generic/zig.js';

/**
 * Plaza (plaza.newnewnew.space), studios and rooms for students, starters and
 * expats. Checked on 2026-09-24: 50 objects, Utrecht 30, Geldrop 10, Delft 3,
 * Rijswijk 2; 21 "reactiedatum" (first come, first served) and 29 reserved
 * university rooms offered to invited students only (skipped). The rooms
 * field is always 0 here, so it is ignored.
 */
export const plaza: ZigPortalDef = {
  id: 'plaza',
  name: 'Plaza Resident Services',
  homepage: 'https://plaza.newnewnew.space',
  detailPath: '/aanbod/huurwoningen/details/',
  regions: [
    'utrecht',
    'delft',
    'rijswijk',
    'amsterdam',
    'ouder-amstel',
    'breda',
    'geldrop-mierlo',
    'eindhoven',
    'maastricht',
    'enschede',
    'deventer',
  ],
  registration: 'Plaza account, EUR 27.50 per year',
  roomsField: false,
  intervalSec: 60,
};
