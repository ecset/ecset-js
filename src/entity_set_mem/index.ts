import { createUUID, isInteger } from "@odgn/utils";
import {
    BitField,
    create as createBitField,
    get as bfGet,
    set as bfSet,
    count as bfCount,
    or as bfOr,
    toValues as bfToValues,
    isBitField
} from "@odgn/utils/bitfield";
import {
    Component,
    ComponentId,
    fromComponentId,
    getComponentDefId,
    getComponentEntityId,
    getComponentId,
    isComponent,
    isComponentId,
    toComponentId,
    setEntityId as setComponentEntityId,
} from "../component";
import {
    ComponentDef,
    ComponentDefId,
    ComponentDefObj,
    create as createComponentDef,
    hash as hashComponentDef,
    Type as DefT
} from "../component_def";
import { MatchOptions } from "../constants";
import {
    Entity,
    EntityId,
    getEntityId,
    isEntity,

} from "../entity";
import { AddOptions, CloneOptions, EntitySet, EntitySetOptions, RemoveEntityType, RemoveType } from "../entity_set";
import {
    create as createChangeSet,
    add as addCS,
    update as updateCS,
    remove as removeCS,
    find as findCS,
    merge as mergeCS,
    ChangeSetOp, getChanges
} from "../change_set";

/**
 * 
 */
export class EntitySetMem extends EntitySet {


    components = new Map<ComponentId, Component>();
    entities = new Map<EntityId, BitField>();

    type: string;
    isEntitySetMem!: boolean;

    constructor(data?: EntitySet, options: EntitySetOptions = {}) {
        super(data, options);
        if (data !== undefined) {
            Object.assign(this, data);
        }
    }

    /**
     * 
     * @returns 
     */
    getUrl(): string {
        return `es://${this.type}/?uuid=${this.uuid}`;
    }

    /**
     * 
     * @param options 
     * @returns 
     */
    async clone(options: CloneOptions = {}): Promise<EntitySet> {
        let includeDefs = options.cloneDefs ?? true;
        let includeEnts = includeDefs ? options.cloneEntities ?? true : false;

        let { componentDefs, components, entities, byUrl, byHash, entChanges, comChanges } = this;
        if (!includeEnts) {
            components = undefined;
            entities = undefined;
            entChanges = undefined;
            comChanges = undefined;
        }
        if (!includeDefs) {
            componentDefs = undefined;
            byHash = undefined;
            byUrl = undefined;
        }
        let props = {
            ...this,
            uuid: createUUID(),
            components: new Map<ComponentId, Component>(components),
            entities: new Map<EntityId, BitField>(entities),
            componentDefs: componentDefs ? [...componentDefs] : [],
            byUrl: new Map<string, number>(byUrl),
            byHash: new Map<number, number>(byHash),
            entChanges: createChangeSet(entChanges),
            comChanges: createChangeSet(comChanges),
        }


        let result = new EntitySetMem(props as any);
        // console.log('[mem][clone]', this.components, result.components);

        return result;
    }

    async size(): Promise<number> {
        return this.entities.size;
    }




    /**
     * Register a ComponentDef with this EntitySet
     */
    async register(value: ComponentDef | ComponentDefObj | any): Promise<ComponentDef> {

        let did = this.componentDefs.length + 1;

        let def = createComponentDef(did, value);

        // Hash the def, and check whether we already have this
        let hash = hashComponentDef(def);

        const existing = this.getByHash(hash);
        if (existing !== undefined) {
            // throw new Error(`component definition already exists (${existing[DefT]}/${existing.url})`);
            return existing;
        }

        // seems legit, add it
        def = { ...def, [DefT]: did };

        this.byHash.set(hash, did);
        this.byUrl.set(def.url, did);

        this.componentDefs = [...this.componentDefs, def];

        return def;
    }


    /**
     * 
     * @returns 
     */
    async getComponentDefs(): Promise<ComponentDef[]> {
        return Promise.resolve(this.componentDefs);
    }



    /**
     * 
     */
    async applyUpdates() {

        if (this.entUpdates.size > 0) {

            // console.log('[add]', 'applying entity updates', this.entUpdates );
            const entities = new Map<number, BitField>(this.entities);

            for (const [eid, bf] of this.entUpdates) {
                if (bf === undefined) {
                    entities.delete(eid);
                } else {
                    entities.set(eid, bf);
                }
            }

            this.entities = entities;
            // console.log('[add]', 'applying entity updates', this.entities );
            this.entUpdates.clear();

            // console.log('[add]', 'cleared entity updates', this.entUpdates );
        }

        if (this.comUpdates.size > 0) {
            // console.log('[add]', 'applying com updates', this.comUpdates );

            const components = new Map<ComponentId, Component>(this.components);

            for (const [cid, com] of this.comUpdates) {
                components.set(cid, com);
            }

            this.components = components;

            this.comUpdates.clear();
        }
    }

    /**
     * 
     * @param components 
     * @param options 
     * @returns 
     */
    async addComponents(components: Component[], options: AddOptions = {}): Promise<EntitySet> {
        const debug = options.debug ?? false;
        // set a new (same) entity id on all orphaned components
        components = this.assignEntityIds(components)

        // Log.debug('[addComponents]', components);

        // to keep track of changes only in this function, we must temporarily replace
        let changes = this.comChanges;
        this.comChanges = createChangeSet<ComponentId>();
        // clearChanges()

        // mark incoming components as either additions or updates
        await components.reduce((p, com) => p.then(() => this.markComponentAdd(com, options)), Promise.resolve());

        // gather the components that have been added or updated and apply
        let changedCids = getChanges(this.comChanges, ChangeSetOp.Add | ChangeSetOp.Update)
        // if( debug ) console.log('[addComponents]', 'pre', changedCids);

        this.comChanges = mergeCS(changes, this.comChanges);
        // if( debug ) console.log('[addComponents]', 'changes', this.comChanges);

        // sequentially apply
        await changedCids.reduce((p, cid) => p.then(() => this.applyUpdatedComponents(cid)), Promise.resolve());

        // console.log('[addComponents]', 'ent updates', this.entUpdates.size);

        return this;
    }

    /**
     * 
     * @param components 
     * @param options 
     */
    async removeComponents(items: RemoveType[], options: AddOptions = {}): Promise<EntitySet> {
        if (options.retain !== true) {
            this.clearChanges();
        }
        for (const item of items) {
            let cid = isComponentId(item) ?
                item as ComponentId
                : isComponent(item) ? getComponentId(item as Component) : undefined;
            this.markComponentRemove(cid);
        }

        return this.applyRemoveChanges();
    }

    /**
     * 
     * @param item 
     * @param options 
     */
    async removeComponent(item: RemoveType, options: AddOptions = {}): Promise<EntitySet> {
        return this.removeComponents([item], options);
    }




    /**
     * 
     * @param item 
     * @param options 
     */
    async removeEntity(item: (RemoveEntityType), options: AddOptions = {}): Promise<EntitySet> {
        if (options.retain !== true) {
            this.clearChanges();
        }

        let eids: EntityId[];

        if (!Array.isArray(item)) {
            item = [item] as any[];
        }

        eids = (item as any[]).map(ii => isInteger(ii) ? ii : isEntity(ii) ? getEntityId(ii as Entity) : 0)
            .filter(it => it !== 0);

        if (eids.length === 0) {
            return this;
        }
        await this.markEntityComponentsRemove(eids);

        return this.applyRemoveChanges();
    }

    async getComponent(id: ComponentId | Component): Promise<Component> {
        return this.getComponentMem(id);
    }

    /**
     * 
     * @param id 
     */
    getComponentMem(id: ComponentId | Component): Component {
        if (isComponentId(id)) {
            return this.components.get(id as ComponentId);
        }
        const cid = getComponentId(id as Component);
        return this.components.get(cid);
    }

    /**
     * Return an Entity by its id
     * @param eid 
     * @param populate 
     * @returns 
     */
    async getEntity(eid: EntityId, populate: BitField | boolean = true): Promise<Entity> {
        return this.getEntityMem(eid, populate);
    }

    /**
     * todo : use MatchOptions
     * @param eid 
     * @param populate 
     */
    getEntityMem(eid: EntityId, populate: BitField | boolean = true): Entity {
        let ebf = this.entities.get(eid);
        if (ebf === undefined) {
            return undefined;
        }
        let e = this.createEntity(eid, ebf);

        if (!populate) {
            return e;
        }

        const dids = bfToValues(isBitField(populate) ? (populate as BitField) : ebf);

        for (const did of dids) {
            const com = this.components.get(toComponentId(eid, did));

            e = this.addComponentToEntity(e, com);
        }

        return e;
    }

    /**
     * Returns Entity instances for the supplied list of EntityIds
     * 
     * @param eids 
     */
    getEntitiesByIdMem(eids: EntityId[] | boolean, options: MatchOptions = {}): Entity[] {
        const entities = this.entities;
        const populate = options.populate ?? false;

        if (Array.isArray(eids)) {
            return eids.map(eid => {
                let ebf = entities.get(eid);
                return ebf === undefined ? undefined
                    : this.getEntityMem(eid, populate);
            });
        }
        let result = [];
        if (eids === true) {
            for (const [eid] of this.entities) {
                result.push(this.getEntityMem(eid, populate));
            }
        }
        return result;
    }

    /**
     * 
     * @param dids 
     * @param options 
     */
    // getEntitiesByDefId( dids:ComponentDefId[], options:MatchOptions ): Promise<Entity[]|EntityId[]> {

    //     return Promise.resolve([]);
    // }

    // getEntities(): Promise<EntityId[]> {
    //     return Promise.resolve( Array.from(this.entities.keys()) );
    // }

    async *[Symbol.asyncIterator]() {
        for (const eid of this.entities.keys()) {
            yield eid;
        }
    }

    // abstract getEntities(populate?: BitField|boolean): AsyncGenerator<Entity, void, void>;
    async *getEntities(populate: BitField | boolean = true): AsyncGenerator<Entity, void, void> {
        for (const eid of this.entities.keys()) {
            yield await this.getEntity(eid, populate);
        }
    }

    async *getComponents(): AsyncGenerator<Component, void, void> {
        for (const [cid, com] of this.components) {
            yield com;
        }
    }

    /**
     * 
     * @param bf 
     * @param options 
     */
    // getEntitiesMem(bf: BitField, options: MatchOptions = {}): Entity[] {
    //     const populate = options.populate ?? false;
    //     const eids = matchEntities(this, undefined, bf);
    //     let result = [];
    //     for (let ii = 0, len = eids.length; ii < len; ii++) {
    //         result.push(this.getEntityMem(eids[ii], populate));
    //     }
    //     return result;
    // }

    /**
     * 
     * @param bf 
     * @param options 
     */
    // getComponentsMem(bf: BitField, options: MatchOptions = {}): Component[] {
    //     let coms: Component[] = [];
    //     let limit = options.limit ?? Number.MAX_SAFE_INTEGER;
    //     for (const [cid, com] of this.components) {
    //         const [, did] = fromComponentId(cid);
    //         if (bfGet(bf, did)) {
    //             coms.push(com);
    //         }
    //         if (coms.length >= limit) {
    //             break;
    //         }
    //     }
    //     return coms;
    // }

    // /**
    //  * 
    //  * @param mbf 
    //  * @param options 
    //  */
    // matchComponents(mbf:BitField, options: MatchOptions = {}): Component[] {
    //     let matches:Component[] = [];
    //     let limit = options.limit ?? Number.MAX_SAFE_INTEGER;

    //     for( let [cid, com] of this.components ){
    //         const [eid,did] = fromComponentId(cid);
    //         if( mbf.isAllSet || bfGet(mbf,did) === true ){
    //             matches.push(com);
    //         }
    //         if( matches.length >= limit ){
    //             break;
    //         }
    //     }

    //     return matches;
    // }


    /**
     * Returns the first component that matches the bitfield and the supplied
     * comparison function
     * @param mbf 
     * @param cb 
     */
    findComponent(mbf: BitField, cb: (com: Component, eid: EntityId, did: ComponentDefId) => boolean): Component {
        for (let [cid, com] of this.components) {
            const [eid, did] = fromComponentId(cid);
            if (mbf.isAllSet || bfGet(mbf, did) === true) {
                if (cb(com, eid, did)) {
                    return com;
                }
            }
        }
        return undefined;
    }

    async getOrAddEntityBitfield(eid: number): Promise<BitField> {
        let record = this.entUpdates.get(eid);

        // Log.debug('[getOrAddEntityBitfield]', bfToValues(record), bfToValues(es.entities.get(eid)) );

        if (record === undefined) {
            record = this.entities.get(eid);

            if (record === undefined) {
                this.markEntityAdd(eid);
                return createBitField();
            }
        }

        // let ebf = createBitField(record);
        // Log.debug('[getOrAddEntityBitfield]!', bfToValues(record), bfToValues(ebf) );

        return record;
    }



    setEntity(e: Entity): Entity {
        let eid = getEntityId(e);
        let bf = e.bitField || createBitField();

        if (eid === 0) {
            eid = this.createEntityId();
        }

        // console.log('[setEntity]', eid);
        this.entUpdates.set(eid, bf);
        e.id = eid;
        return e;
    }


    /**
     * Takes an array of Components and assigns Entity ids to
     * those which dont have one
     * 
     * @param components 
     * @returns 
     */
    assignEntityIds(components: Component[]): Component[] {
        let coms = [];
        let eids = new Set();
        let eid = 0;
        let comEid = 0;
        for (let com of components) {
            // ensure the component did is resolved
            com = this.resolveComponent(com);

            let did = getComponentDefId(com);

            comEid = getComponentEntityId(com);

            // component already has an id - add it to the list of components
            if (comEid !== 0) {
                coms.push(com);
                continue;
            }


            // not yet assigned an entity, or we have already seen this com type
            if (eid === 0 || eids.has(did)) {
                // create a new entity - this also applies if we encounter a component
                // of a type we have seen before
                eid = this.createEntityAlt();// await createEntity(es);
                comEid = eid;

                // Log.debug('[assignEntityIds]', 'new e', eid);

                eids = new Set();
                // mark the def as having been seen, store the new entity, add the component
                eids.add(did);
            } else {
                comEid = eid;
            }

            // Log.debug('[assignEntityIds]', 'com eid', {comEid, eid}, eids);

            com = setComponentEntityId(com, comEid);
            // Log.debug('[aei]', 'eid was', eid, com);
            coms.push(com);
        }

        return coms;
    }


    /**
     * 
     * @param com 
     * @param options 
     * @returns 
     */
    async markComponentAdd(com: Component, options: AddOptions = {}): Promise<EntitySet> {
        const debug = options.debug ?? false;
        // adds the component to the entityset if it is unknown,
        // otherwise marks as an update
        const cid = getComponentId(com);
        let existing;

        // try for already updated
        existing = this.comUpdates.get(cid);

        if (existing === undefined) {
            // hit the store
            existing = await this.getComponent(cid);
        }

        if (existing !== undefined) {
            let isChanged = this.isComponentChanged(com, existing);

            if (!isChanged) {
                return this;
            }
        }


        this.comUpdates.set(cid, com);

        if (existing !== undefined) {
            this.emit('/component/upd', com, existing);
            return this.markComponentUpdate(cid);
        }

        this.emit('/component/add', com);

        this.comChanges = addCS(this.comChanges, cid);

        return this;
    }

    markComponentUpdate(cid: ComponentId) {
        this.comChanges = updateCS(this.comChanges, cid)
        // console.log('[markComponentUpdate]', cid);
        return this;
    }

    markComponentRemove(cid: ComponentId) {
        this.comChanges = removeCS(this.comChanges, cid);
        return this;
    }

    markEntityAdd(eid: EntityId) {
        this.entChanges = addCS(this.entChanges, eid);
        this.emit('/entity/add', eid);
        return this;
    }
    markEntityUpdate(eid: EntityId) {
        this.entChanges = updateCS(this.entChanges, eid);
        this.emit('/entity/upd', eid);
        return this;
    }
    markEntityRemove(eid: EntityId) {
        this.entChanges = removeCS(this.entChanges, eid);
        this.emit('/entity/rem', eid);
        return this;
    }

    /**
     * Compares two components and returns true if the
     * components are different
     * 
     * @param a 
     * @param b 
     * @returns 
     */
    isComponentChanged(a: Component, b: Component): boolean {
        if (this.componentCmp) {
            return this.componentCmp(a, b);
        }

        // obviously problematic, but suffices for simple cases
        return JSON.stringify(a) !== JSON.stringify(b);
    }

    /**
     * 
     * @param eid 
     */
    async markEntityComponentsRemove(eids: EntityId[]): Promise<EntitySet> {

        for (let ii = 0; ii < eids.length; ii++) {
            const eid = eids[ii];
            let ebf = this.entities.get(eid);
            if (ebf === undefined) { continue; }
            const dids = bfToValues(ebf);
            for (let dd = 0; dd < dids.length; dd++) {
                this.markComponentRemove(toComponentId(eid, dids[dd]));
            }
        }

        return this;
    }


    /**
     * 
     * @param eid 
     */
    applyRemoveEntity(eid: EntityId) {
        // console.log('[applyRemoveEntity]', eid);
        this.entities.delete(eid);
    }

    /**
     * Applies any removal operations that have previously been marked
     */
    async applyRemoveChanges(): Promise<EntitySet> {
        const removedComs = getChanges(this.comChanges, ChangeSetOp.Remove);
        if (removedComs.length === 0) {
            return this;
        }

        for (const cid of removedComs) {
            this.applyRemoveComponent(cid);
        }

        // Log.debug('[applyRemoveChanges]', removedComs );

        const removedEnts = getChanges(this.entChanges, ChangeSetOp.Remove);

        for (const eid of removedEnts) {
            this.applyRemoveEntity(eid);
        }

        return this;
    }

    /**
     * 
     * @param cid 
     */
    async applyUpdatedComponents(cid: ComponentId): Promise<EntitySet> {
        const [eid, did] = fromComponentId(cid);
        let ebf: BitField;
        // console.log('[applyUpdatedComponents]', eid, did, this.entChanges );
        // console.log('[applyUpdatedComponents]', 'in', this.entUpdates);

        ebf = await this.getOrAddEntityBitfield(eid);

        // console.log('[applyUpdatedComponents]', eid, did, ebf );

        const isNew = findCS(this.entChanges, eid) === ChangeSetOp.Add;
        const hasComponent = bfGet(ebf, did) === true;
        // console.log('[applyUpdatedComponents]', eid, did, isNew, bfGet(ebf,did) === false, findCS(this.entChanges, eid) );

        // does the component already belong to this entity?
        if (!hasComponent) {
            let e = this.createEntity(eid);// new Entity(eid);
            // console.log('[applyUpdatedComponents]', eid, did, bfToValues(e.bitField) );
            e.bitField = bfSet(ebf, did);

            // console.log('[applyUpdatedComponents]', eid, did, isNew, bfToValues(e.bitField), this.entChanges );

            this.setEntity(e);
            // console.log('[applyUpdatedComponents]', eid, did, this.entUpdates );
        }

        // if (isNew) {
        this.markEntityUpdate(eid);
        // }
        // console.log('[applyUpdatedComponents]', 'out', this.entUpdates);

        return this;
    }

    async applyRemoveComponent(cid: ComponentId): Promise<EntitySet> {
        let [eid, did] = fromComponentId(cid);

        // remove the component id from the entity
        let ebf = this.entUpdates.get(eid);

        if (ebf === undefined) {
            ebf = createBitField(this.entities.get(eid));
        }

        // remove from the entity
        ebf = bfSet(ebf, did, false);


        // remove component from the internal component map
        let components = new Map<ComponentId, Component>(this.components);
        components.delete(cid);

        this.components = components;

        // console.log('[applyRemoveComponent]', cid, bfCount(ebf) );

        if (bfCount(ebf) === 0) {
            this.entUpdates.set(eid, undefined);
            return this.markEntityRemove(eid);
        }
        // console.log('[applyRemoveComponent]', 'set', eid, bfCount(ebf));
        this.entUpdates.set(eid, ebf);
        return this.markEntityUpdate(eid);

    }




    createEntityAlt(): EntityId {
        let eid = this.createEntityId();
        this.markEntityAdd(eid);
        return eid;
    }


}

EntitySetMem.prototype.type = 'mem';
EntitySetMem.prototype.isEntitySetMem = true;
