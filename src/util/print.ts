import { Entity, isEntity } from '../entity';
import { EntitySet } from '../entity_set';
import { BitField, get as bfGet } from '@odgn/utils/bitfield';
import { linkSync } from 'fs-extra';
import { QueryableEntitySet } from '../entity_set/queryable';

/**
 * Prints all entities to console.log
 *
 * @param es
 * @param ents
 * @param dids
 */
export async function printAll(es: EntitySet, ents?: Entity[], dids?: string[]) {
    console.log(`[${es.getUrl()}]:`);
    if (ents) {
        for (const e of ents) {
            printEntity(es, e, dids);
        }
    } else
        for await (const e of es.getEntities()) {
            printEntity(es, e, dids);
        }
}

export async function printQuery(es: QueryableEntitySet, q: string) {
    const result = await es.queryEntities(q);
    for (const e of result) {
        printEntity(es, e);
    }
}

export function printEntity(es: EntitySet, e: Entity, dids?: string[]) {
    let bf: BitField;
    if (!isEntity(e)) {
        // throw new Error('non entity');
        console.warn('non entity');
        return;
    }
    if (es === undefined || e === undefined) {
        console.log('(undefined e)');
        return;
    }

    const lines = [`- e(${yellow(e.id)})`];
    if (e.components === undefined) {
        console.log(lines[0]);
        return;
    }
    if (dids !== undefined) {
        bf = es.resolveComponentDefIds(dids);
    }
    // console.log(`- e(${yellow(e.id)})`);
    for (const [did, com] of e.components) {
        if (bf && bfGet(bf, did) === false) {
            continue;
        }
        const { '@e': eid, '@d': _did, ...rest } = com;
        const def = es.getByDefId(did);
        // console.log(`   ${def.name}`, JSON.stringify(rest));
        lines.push(`   ${def.name} ${JSON.stringify(rest)}`);
    }
    if (lines.length > 1) {
        console.log(lines.join('\n'));
    }
}

const Reset = '\x1b[0m';
const FgYellow = '\x1b[33m';
function yellow(str: any) {
    return `${FgYellow}${str}${Reset}`;
}

// function selectAll(es: EntitySet): Entity[] {
//     if( es instanceof EntitySetMem ){
//         return es.getEntitiesByIdMem(true, { populate: true });
//     }
//     return [];
// }
