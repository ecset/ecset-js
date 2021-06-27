import Jsonpointer from 'jsonpointer';
import { getDefId } from '../component_def';
import { Entity } from '../entity';
import { EntitySet } from '../entity_set';

/**
 *
 * @param es
 * @param e
 * @param url
 */
export function getEntityAttribute(es: EntitySet, e: Entity, url: string) {
    const parts = /(^\/.*)#(.*)/.exec(url);

    if (parts == null) {
        throw new Error(`invalid url: ${url}`);
    }

    let [, did, attr] = parts;

    // let {path:did,anchor:attr} = parseUri(url);

    // console.log( parts );

    const def = es.getByUrl(did);
    if (def === undefined) {
        throw new Error(`com path not found: ${url}`);
    }
    const com = e.getComponent(getDefId(def));

    if (!attr.startsWith('/')) {
        attr = '/' + attr;
    }

    return Jsonpointer.get(com, attr); // com[ attr ];
}
