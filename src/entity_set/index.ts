import {
    Component,
    isComponentLike,
    ComponentId,
    create as createComponentInstance,
    isExternalComponent,
    OrphanComponent
} from "../component";
import {
    BitField,
    create as createBitField,
    get as bfGet,
    set as bfSet,
} from "@odgn/utils/bitfield";
import {
    Type as DefT,
    ComponentDef,
    ComponentDefId,
    ComponentDefObj,
    getProperty,
    getDefId,
    isComponentDef,
} from "../component_def";
import {
    Entity,
    isEntity,
    EntityId
} from "../entity";
import { createUUID } from '@odgn/utils';
import {
    create as createChangeSet,
    ChangeSetOp, getChanges
} from "../change_set";
import { isInteger, isObject, isString } from '@odgn/utils';

import { buildFlake53 } from '@odgn/utils';
import { QueryStack } from "../query/stack";



export interface AddOptions {
    debug?: boolean;
    retain?: boolean;
}


export function isEntitySet(value: any): boolean {
    return isObject(value) && value.isEntitySet === true;
}

export function isEntitySetMem(value: any): boolean {
    return isObject(value) && value.isEntitySetMem === true;
}

export type EntityIdGen = () => EntityId;

export interface EntitySetOptions {
    readDefs?: boolean;
    debug?: boolean;
    eidEpoch?: number;
    uuid?: string;
    // optional id generator
    idgen?: EntityIdGen;
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

let workerIdBase = 0;

export abstract class EntitySet {
    
    isEntitySet!: boolean;
    isAsync!: boolean;
    type!: string;

    uuid: string = createUUID();

    componentDefs: ComponentDef[] = [];
    byUri = new Map<string, number>();
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

    stack: QueryStack;
    

    constructor(data?: EntitySet, options: EntitySetOptions = {}) {
        if (data !== undefined) {
            Object.assign(this, data);
        }
        this.idgen = options.idgen;
        this.eidEpoch = options.eidEpoch ?? 1609459200000; // 2021-01-01T00:00:00.000Z
    }

    /**
     * Returns a url indicating the type/config of this EntitySet
     */
    abstract getUrl(): string;

    abstract clone(options?: CloneOptions): Promise<EntitySet>;

    // abstract select(stack: QueryStack, query: StackValue[]): Promise<StackValue[]>;

    abstract size(): Promise<number>;

    // abstract add(item: AddType, options?: AddOptions): Promise<EntitySet>;

    /**
     * Returns an entity by its id
     * 
     * @param eid 
     * @param populate 
     */
    abstract getEntity(eid: EntityId, populate?: BitField|boolean): Promise<Entity>;


    /**
     * Returns a generator of all entities in the set
     */
    abstract getEntities(populate?: BitField|boolean): AsyncGenerator<Entity, void, void>;

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
            let initial: [Entity[], Component[]] = [[], []];
            // sort the incoming items into entities and components
            let [ents, coms] = (item as any[]).reduce(([ents, coms], item) => {
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
                await ents.reduce((p, e) => p.then(() => this.addComponents(e.getComponents(), options)), Promise.resolve());
            }

            // add components
            await this.addComponents(coms, options);
        }
        else if (isComponentLike(item)) {
            await this.addComponents([item as Component], options);
        }
        else if (isEntity(item)) {
            let e = item as Entity
            // if( debug ){ console.log('add', e)}
            this.markEntityComponentsRemove([e.id]);
            await this.addComponents(e.getComponents(), options);
        }
        else if (isEntitySet(item)) {
            let es = item as EntitySet;
            // apply defs
            let defs = await es.getComponentDefs();
            let didTable = new Map<ComponentDefId, ComponentDefId>();


            // register sender defs and record their ids
            for (let ii = 0, len = defs.length; ii < len; ii++) {
                let def = defs[ii];
                await this.register(def);
                let rdef = this.getByHash(def.hash);
                didTable.set(getDefId(def), getDefId(rdef));
            }

            // console.log('[add][es]', 'convert', didTable);
            // console.log('[add][es]', 'convert', es.components);

            // rebuild each of the sender components altering their
            // def id
            let coms: Component[] = [];

            for await( const com of es.getComponents() ){
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

    async beginUpdates() {
    }
    async applyUpdates() {
    }


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
            sequence: this.eidSeq++
        });
    }

    createComponent(defId: (string | number | ComponentDef), attributes = {}): Component {
        let def: ComponentDef = undefined;

        if (isString(defId)) {
            def = this.getByUri(defId as string);
        } else if (isInteger(defId)) {
            def = this.getByHash(defId as number) || this.componentDefs[(defId as number) - 1];
        } else if (isComponentDef(defId)) {
            def = defId as any as ComponentDef;
        }

        // Log.debug('[createComponent]', defId, attributes, def );
        if (def === undefined) {
            // Log.debug('[createComponent]', registry.byUri.get( defId as string ), registry.componentDefs );
            throw new Error(`component def not found: ${defId}`);
        }

        let params = {
            ...attributes,
            '@d': def[DefT]
        };

        // create a component instance
        const component = createComponentInstance(params);

        return component;
    }

    getByUri(uri: string): ComponentDef {
        const did = this.byUri.get(uri);
        return did === undefined ? undefined : this.componentDefs[did - 1];
    }

    getByDefId(defId: number): ComponentDef {
        return this.componentDefs[defId - 1];
    }

    getByHash(hash: number): ComponentDef {
        const did = this.byHash.get(hash);
        return did === undefined ? undefined : this.componentDefs[did - 1];
    }

    /**
     * 
     */
    addComponentToEntity(e: Entity, com: Component): Entity {
        return e.addComponentUnsafe(com);
    }


    

    resolveComponent(com: (OrphanComponent | Component)): Component {
        if (!isExternalComponent(com)) {
            return com as any;
        }
        const sdid = com[DefT] as string;
        const def = this.getByUri(sdid);
        if (def === undefined) {
            throw new Error(`def id not found ${sdid}`);
        }
        const did = def[DefT];
        return { ...com, [DefT]: did } as any;
    }

    resolveComponentDefAttribute(did: string): [BitField, string] {

        let attrName: string;
        const isAttr = (did as string).indexOf('#') !== -1;
        if (isAttr) {
            [did, attrName] = (did as string).split('#');
        }

        // Log.debug('[resolveComponentDefAttribute]', did,attrName );

        const def = this.getByUri(did);

        if (!def) {
            // Log.debug('[resolveComponentDefAttribute]', 'def not found', did);
            return [createBitField(), undefined];
        }

        // Log.debug('[resolveComponentDefAttribute]', 'getting prop', def, attrName );

        const prop = getProperty(def, attrName);

        const bf = createBitField([getDefId(def)])

        // console.log('[resolveComponentDefAttribute]', did, isAttr, attrName, def.properties );

        // Log.debug('[resolveComponentDefAttribute]', def, attrName );
        return [bf, prop ? attrName : undefined];
    }


    /**
     * Resolves an array of Def identifiers (uri,hash, or did) to ComponentDefs  
     * 
     * @param value defId or url
     * @returns a bitfield with the resolved def ids
     */
    resolveComponentDefIds(value: ResolveDefIds): BitField {
        const bf = createBitField();

        let dids = Array.isArray(value) ? value : [value];
        if (dids.length === 0) {
            return bf;
        }

        const defs: ComponentDef[] = (dids as []).map(did => {
            // Log.debug('[resolveComponentDefIds]', did, registry );
            if (isString(did)) {
                return this.getByUri(did);
            }
            else if (isInteger(did)) {
                return this.getByHash(did) || this.componentDefs[did - 1];
            }
            return undefined;
        });

        return defs.reduce((bf, def) => 
            def === undefined ? 
                bf : 
                bfSet(bf, getDefId(def)), 
        bf);
    }

    /**
     * Resolves a def uri to its Did
     * @param value 
     */
    resolveComponentDefId(value: string): ComponentDefId {
        const def = this.getByUri(value);
        return def !== undefined ? def[DefT] : 0;
    }
}

EntitySet.prototype.isEntitySet = true;
EntitySet.prototype.isAsync = true;
EntitySet.prototype.type = 'es';
