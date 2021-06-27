import { Component, getComponentDefId, setEntityId as setComponentEntityId } from './component';
import { isObject, isInteger } from '@odgn/utils';
import {
    BitField,
    create as createBitField,
    set as bfSet,
    and as bfAnd,
    toValues as bfToValues,
} from '@odgn/utils/bitfield';
import { ComponentDefId, ComponentDef, getDefId } from './component_def';

export const Type = '@e';

export type EntityId = number;

// type EntityMap = Map<number, BitField>;
export type EntityMap = Map<EntityId, BitField>;

export class Entity {
    id: EntityId = 0;

    // maps component defId to Component
    components: Map<ComponentDefId, Component>; // = new Map<ComponentDefId,Component>();

    // tracks component defIds contained on this entity
    bitField: BitField;

    isEntity = true;

    // to allow Component direct access and modification
    [key: string]: any;

    constructor(id: EntityId = 0, bitField: BitField = createBitField()) {
        this.id = id;
        this.bitField = bitField;
    }

    /**
     * A direct means of adding an already owned component to the entity
     *
     * its unsafe because the component won't necesarily be able to accessed via
     * property
     * @param entity
     * @param component
     */
    addComponentUnsafe(com: Component): Entity {
        const did = getComponentDefId(com);
        const eid = getEntityId(this);
        this.components = this.components ?? new Map<ComponentDefId, Component>();

        if (com === undefined) {
            this.components.delete(did);
            this.bitField = bfSet(this.bitField, did, false);
        } else {
            com = setComponentEntityId(com, eid);
            this.components.set(did, com);
            this.bitField = bfSet(this.bitField, did);
        }

        return this;
    }

    getComponent(defId: ComponentDefId): Component {
        return this.components.get(defId);
    }

    getComponents(bf?: BitField): Component[] {
        if (this.components === undefined) {
            return [];
        }
        if (bf !== undefined) {
            return bfToValues(bf)
                .map((did) => this.components.get(did))
                .filter(Boolean);
        }
        return Array.from(this.components.values());
    }

    hasComponents(bf: BitField): boolean {
        // console.log('[hasComponents]', bfToValues(this.bitField), bfToValues(bf), bfAnd(bf, this.bitField) );
        // if( !this.bitField ){
        //     console.log('huh', this);
        // }
        return bfAnd(bf, this.bitField);
    }

    get size(): number {
        // return this.components.size;
        return this.components == undefined ? 0 : this.components.size;
    }

    /**
     * Alters the Entity instance to allow convenient setting
     * and retrieval of components directly using their names.
     *
     * the component data need not contain did, but there is no
     * checking on the validity of the data
     *
     * @param defs
     */
    defineComponentProperties(defs: ComponentDef[]): Entity {
        const eid = this.id;
        this.components = this.components ?? new Map<ComponentDefId, Component>();
        const props = defs.reduce((props, def) => {
            const did = getDefId(def);
            return {
                ...props,
                [def.name]: {
                    set: (com) => {
                        if (com === undefined) {
                            // remove the component
                            this.components.delete(did);
                            return;
                            // console.log('[set]',def.name, com);
                        }
                        const cdid = getComponentDefId(com);
                        if (cdid !== undefined && cdid !== did) {
                            throw new Error(`invalid set component on ${def.name}`);
                        }
                        com = { ...com, '@e': eid, '@d': did };
                        this.components.set(did, com);
                    },
                    get: () => this.components.get(did),
                    // get: () => {
                    //     console.log('[get]', def.name, did );
                    //     return this.components.get(did)
                    // }
                    // writable: true
                },
            };
        }, {});

        Object.defineProperties(this, props);
        // this._defined = defs.map(d => d.name);

        return this;
    }
}

/**
 *
 * @param entity
 */
export function getEntityId(entity: Entity): EntityId {
    return isEntity(entity) ? entity.id : isEntityId(entity as any) ? (entity as any) : 0;
}

/**
 * Returns true if the value is a valid Entity
 *
 * @param item
 * @returns
 */
export function isEntity(item: any): boolean {
    return isObject(item) && item.isEntity === true;
}

/**
 * Returns true if the value is a valid Entity id
 *
 * @param item
 * @returns
 */
export function isEntityId(item: any): boolean {
    return isInteger(item);
}
