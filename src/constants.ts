import { BitField } from '@odgn/utils/bitfield';

export interface MatchOptions {
    limit?: number;
    returnEntities?: boolean;
    populate?: BitField | boolean;
}
