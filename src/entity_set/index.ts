import {
    Component,
    isComponentLike,
    ComponentId,
    create as createComponentInstance,
    isExternalComponent,
    OrphanComponent,
} from '../component';
import { BitField, create as createBitField, get as bfGet, set as bfSet } from '@odgn/utils/bitfield';
import {
    Type as DefT,
    ComponentDef,
    ComponentDefId,
    ComponentDefObj,
    getProperty,
    getDefId,
    isComponentDef,
} from '../component_def';
import { Entity, isEntity, EntityId } from '../entity';
import { createUUID } from '@odgn/utils';
import { create as createChangeSet, ChangeSetOp, getChanges } from '../change_set';
import { isInteger, isObject, isString } from '@odgn/utils';

import { buildFlake53 } from '@odgn/utils';

export interface AddOptions {
    debug?: boolean;
    retain?: boolean;
}

type EntitySetCandidate = any;

export function isEntitySet(value: EntitySetCandidate): boolean {
    return isObject(value) && value.isEntitySet === true;
}

export function isEntitySetMem(value: EntitySetCandidate): boolean {
    return isObject(value) && value.isEntitySetMem === true;
}

export type EntityIdGen = () => EntityId;

export type ComponentCmp = (a: Component, b: Component) => boolean;

export interface EntitySetOptions {
    readDefs?: boolean;
    debug?: boolean;
    eidEpoch?: number;
    uuid?: string;
    // optional id generator
    idgen?: EntityIdGen;
    componentCmp?: ComponentCmp;
}

export interface CloneOptions {
    cloneDefs?: boolean;
    cloneEntities?: boolean;
}

export type ResolveComponentDefIdResult = [Component, string][] | [BitField, string][];

export type ResolveDefIds = string | string[] | ComponentDefId | ComponentDefId[];

export type AddArrayType = (Entity | Component)[];
export type AddType = Entity | Component | OrphanComponent | AddArrayType | EntitySet;
export type RemoveType = ComponentId | Entity | Component | EntitySet;
export type RemoveEntityType = EntityId | EntityId[] | Entity | Entity[];

export type Listener = (...args: any[]) => void;
export interface Events {
    [event: string]: Listener[];
}

let workerIdBase = 0;

export abstract class EntitySet {
    isEntitySet!: boolean;
    isAsync!: boolean;
    type!: string;

    uuid: string = createUUID();

    componentDefs: ComponentDef[] = [];
    byUrl = new Map<string, number>();
    byHash = new Map<number, number>();

    entChanges = createChangeSet<number>();
    comChanges = createChangeSet<ComponentId>();
    comUpdates = new Map<ComponentId, any>();
    entUpdates = new Map<number, BitField>();

    // to slightly reduce the chance of eid collision, we randomise
    // the sequence
    eidSeq: EntityId = Math.floor(Math.random() * 255);

    // by default, make sure the workerId is incremented
    workerId: number = workerIdBase++;

    idgen: EntityIdGen;

    // for generation of entityids
    readonly eidEpoch: number = 1609459200000; // 2021-01-01T00:00:00.000Z

    events: Events = {};

    componentCmp: ComponentCmp;

    constructor(data?: EntitySet, options: EntitySetOptions = {}) {
        if (data !== undefined) {
            Object.assign(this, data);
        }
        this.idgen = options.idgen;
        this.componentCmp = options.componentCmp;
        this.eidEpoch = options.eidEpoch ?? 1609459200000; // 2021-01-01T00:00:00.000Z
    }

    /**
     * Returns a url indicating the type/config of this EntitySet
     */
    abstract getUrl(): string;

    abstract clone(options?: CloneOptions): Promise<EntitySet>;

    abstract size(): Promise<number>;

    /**
     * Returns an entity by its id
     * The Entity will have all its components retrieved by default
     *
     * @param eid
     * @param populate
     */
    abstract getEntity(eid: EntityId, populate?: BitField | boolean): Promise<Entity>;

    /**
     * Returns a generator of all entities in the set
     */
    abstract getEntities(populate?: BitField | boolean): AsyncGenerator<Entity, void, void>;

    /**
     * Returns a generator of all components in the set
     */
    abstract getComponents(): AsyncGenerator<Component, void, void>;

    abstract register(value: ComponentDef | ComponentDefObj | any): Promise<ComponentDef>;

    abstract getComponentDefs(): Promise<ComponentDef[]>;

    /**
     * Returns entities by defId
     *
     * @param dids
     * @param populate
     */
    // abstract getEntitiesByDefId( dids:ComponentDefId[], options:MatchOptions ): Promise<Entity[]|EntityId[]>;

    /**
     * Returns a Component by its id [entityId,defId]
     *
     * @param id
     */
    abstract getComponent(id: ComponentId | Component): Promise<Component>;

    /**
     * Removes an entity by its id
     * @param item
     * @param options
     */
    abstract removeEntity(item: RemoveEntityType, options?: AddOptions): Promise<EntitySet>;

    abstract removeComponent(item: RemoveType, options?: AddOptions): Promise<EntitySet>;

    abstract removeComponents(items: RemoveType[], options?: AddOptions): Promise<EntitySet>;

    /**
     *
     * @param item
     * @param options
     */
    async add<ES extends EntitySet>(item: AddType, options: AddOptions = {}): Promise<ES> {
        await this.openEntitySet();

        await this.beginUpdates();

        if (options.retain !== true) {
            this.clearChanges();
        }

        const { debug } = options;

        // if( debug ){
        //     console.log('[add]', 'entUpdates', this.entUpdates );
        // }

        if (Array.isArray(item)) {
            const initial: [Entity[], Component[]] = [[], []];
            // sort the incoming items into entities and components
            const [ents, coms] = (item as any[]).reduce(([ents, coms], item) => {
                if (isComponentLike(item)) {
                    coms.push(item);
                } else if (isEntity(item)) {
                    ents.push(item);
                }
                return [ents, coms];
            }, initial);

            // console.log('[add]', ents);
            // add components on entities
            if (ents.length > 0) {
                await ents.reduce(
                    (p, e) => p.then(() => this.addComponents(e.getComponents(), options)),
                    Promise.resolve(),
                );
            }

            // add components
            await this.addComponents(coms, options);
        } else if (isComponentLike(item)) {
            await this.addComponents([item as Component], options);
        } else if (isEntity(item)) {
            const e = item as Entity;
            // if( debug ){ console.log('add', e)}
            this.markEntityComponentsRemove([e.id]);
            await this.addComponents(e.getComponents(), options);
        } else if (isEntitySet(item)) {
            const es = item as EntitySet;
            // apply defs
            const defs = await es.getComponentDefs();
            const didTable = new Map<ComponentDefId, ComponentDefId>();

            // register sender defs and record their ids
            for (let ii = 0, len = defs.length; ii < len; ii++) {
                const def = defs[ii];
                await this.register(def);
                const rdef = this.getByHash(def.hash);
                didTable.set(getDefId(def), getDefId(rdef));
            }

            // console.log('[add][es]', 'convert', didTable);
            // console.log('[add][es]', 'convert', es.components);

            // rebuild each of the sender components altering their
            // def id
            const coms: Component[] = [];

            for await (const com of es.getComponents()) {
                let { '@d': did, ...rest } = com;
                did = didTable.get(did);
                coms.push({ '@d': did, ...rest });
            }

            // console.log('[add][es]', 'convert', coms);
            await this.addComponents(coms);
        } else {
            // console.log('[add]', 'no matching type');
        }

        this.applyRemoveChanges();

        await this.applyUpdates();

        return this as unknown as ES;
    }

    async beginUpdates() {}
    async applyUpdates() {}

    clearChanges() {
        this.comChanges = createChangeSet();
        this.entChanges = createChangeSet();
    }

    abstract addComponents(components: Component[], options?: AddOptions): Promise<EntitySet>;

    abstract markEntityComponentsRemove(eids: EntityId[]): Promise<EntitySet>;

    abstract applyRemoveChanges(): Promise<EntitySet>;

    /**
     * Returns an array of EntityId that were added or updated last op
     */
    getUpdatedEntities(): EntityId[] {
        return getChanges(this.entChanges, ChangeSetOp.Add | ChangeSetOp.Update);
    }

    /**
     * Returns an array of EntityId that were removed in the last operation
     */
    getRemovedEntities(): EntityId[] {
        return getChanges(this.entChanges, ChangeSetOp.Remove);
    }

    /**
     *
     * @param options
     * @returns
     */
    async openEntitySet(options: EntitySetOptions = {}): Promise<EntitySet> {
        return this;
    }

    createEntity(eid: EntityId = 0, bf?: BitField): Entity {
        let e = new Entity(eid, bf);
        e = e.defineComponentProperties(this.componentDefs);
        return e;
    }

    createEntityId(): EntityId {
        if (this.idgen !== undefined) {
            return this.idgen();
        }
        return buildFlake53({
            timestamp: Date.now(),
            workerId: this.workerId,
            epoch: this.eidEpoch,
            sequence: this.eidSeq++,
        });
    }

    createComponent(defId: string | number | ComponentDef, attributes = {}): Component {
        let def: ComponentDef = undefined;

        if (isString(defId)) {
            def = this.getByUrl(defId as string);
        } else if (isInteger(defId)) {
            def = this.getByHash(defId as number) || this.componentDefs[(defId as number) - 1];
        } else if (isComponentDef(defId)) {
            def = defId as any as ComponentDef;
        }

        // Log.debug('[createComponent]', defId, attributes, def );
        if (def === undefined) {
            // Log.debug('[createComponent]', registry.byUrl.get( defId as string ), registry.componentDefs );
            throw new Error(`component def not found: ${defId}`);
        }

        const params = {
            ...attributes,
            '@d': def[DefT],
        };

        // create a component instance
        const component = createComponentInstance(params);

        return component;
    }

    /**
     * Returns a ComponentDef by its url
     *
     * @param url
     * @returns
     */
    getByUrl(url: string): ComponentDef {
        const did = this.byUrl.get(url);
        return did === undefined ? undefined : this.componentDefs[did - 1];
    }

    /**
     * Returns a ComponentDef by its id
     *
     * @param defId
     * @returns
     */
    getByDefId(defId: ComponentDefId): ComponentDef {
        return this.componentDefs[defId - 1];
    }

    /**
     * Returns a ComponentDef by its hash
     * @param hash
     * @returns
     */
    getByHash(hash: number): ComponentDef {
        const did = this.byHash.get(hash);
        return did === undefined ? undefined : this.componentDefs[did - 1];
    }

    /**
     * Adds a Component to an Entity
     *
     * @param e
     * @param com
     * @returns
     */
    addComponentToEntity(e: Entity, com: Component): Entity {
        return e.addComponentUnsafe(com);
    }

    /**
     * Takes a Component and attempts to resolve its Def id
     *
     * @param com
     * @returns
     */
    resolveComponent(com: OrphanComponent | Component): Component {
        if (!isExternalComponent(com)) {
            return com as any;
        }
        const sdid = com[DefT] as string;
        const def = this.getByUrl(sdid);
        if (def === undefined) {
            throw new Error(`def id not found ${sdid}`);
        }
        const did = def[DefT];
        return { ...com, [DefT]: did } as any;
    }

    /**
     * Takes a url and attempts to resolve it into
     * a ComponentDef.
     *
     * @param did
     * @returns
     */
    resolveComponentDefAttribute(did: string): [BitField, string] {
        let attrName: string;
        const isAttr = (did as string).indexOf('#') !== -1;
        if (isAttr) {
            [did, attrName] = (did as string).split('#');
        }

        // Log.debug('[resolveComponentDefAttribute]', did,attrName );

        const def = this.getByUrl(did);

        if (!def) {
            // Log.debug('[resolveComponentDefAttribute]', 'def not found', did);
            return [createBitField(), undefined];
        }

        // Log.debug('[resolveComponentDefAttribute]', 'getting prop', def, attrName );

        const prop = getProperty(def, attrName);

        const bf = createBitField([getDefId(def)]);

        // console.log('[resolveComponentDefAttribute]', did, isAttr, attrName, def.properties );

        // Log.debug('[resolveComponentDefAttribute]', def, attrName );
        return [bf, prop ? attrName : undefined];
    }

    /**
     * Resolves an array of Def identifiers (url,hash, or did) to ComponentDefs
     *
     * @param value defId or url
     * @returns a bitfield with the resolved def ids
     */
    resolveComponentDefIds(value: ResolveDefIds): BitField {
        const bf = createBitField();

        const dids = Array.isArray(value) ? value : [value];
        if (dids.length === 0) {
            return bf;
        }

        const defs: ComponentDef[] = (dids as []).map((did) => {
            // Log.debug('[resolveComponentDefIds]', did, registry );
            if (isString(did)) {
                return this.getByUrl(did);
            } else if (isInteger(did)) {
                return this.getByHash(did) || this.componentDefs[did - 1];
            }
            return undefined;
        });

        return defs.reduce((bf, def) => (def === undefined ? bf : bfSet(bf, getDefId(def))), bf);
    }

    /**
     * Resolves a def url to its Did
     * @param value
     */
    resolveComponentDefId(value: string): ComponentDefId {
        const def = this.getByUrl(value);
        return def !== undefined ? def[DefT] : 0;
    }

    on(event: string, listener: Listener): () => void {
        if (typeof this.events[event] !== 'object') {
            this.events[event] = [];
        }

        this.events[event].push(listener);
        return () => this.removeListener(event, listener);
    }

    removeListener(event: string, listener: Listener): void {
        if (typeof this.events[event] !== 'object') {
            return;
        }

        const idx: number = this.events[event].indexOf(listener);
        if (idx > -1) {
            this.events[event].splice(idx, 1);
        }
    }

    removeAllListeners(): void {
        Object.keys(this.events).forEach((event: string) => this.events[event].splice(0, this.events[event].length));
    }

    off(event?, listener?) {
        if (event === undefined && listener === undefined) {
            this.events = {};
        } else if (listener === undefined) {
            delete this.events[event];
        } else if (this.events[event].indexOf(listener) !== -1) {
            this.events[event].splice(this.events[event].indexOf(listener), 1);
        }
    }

    emit(event: string, ...args: any[]): void {
        if (typeof this.events[event] !== 'object') {
            return;
        }

        [...this.events[event]].forEach((listener) => listener.apply(this, args));
    }

    once(event: string, listener: Listener): () => void {
        const remove: () => void = this.on(event, (...args: any[]) => {
            remove();
            listener.apply(this, args);
        });

        return remove;
    }
}

EntitySet.prototype.isEntitySet = true;
EntitySet.prototype.isAsync = true;
EntitySet.prototype.type = 'es';
