import { Component, ComponentId } from './component';
import { ComponentDef, ComponentDefObj } from './component_def';
import { Entity, EntityId } from './entity';
import { AddOptions, CloneOptions, EntitySet, EntitySetOptions, RemoveEntityType, RemoveType } from './entity_set';
import { QueryableEntitySet, SelectOptions } from './entity_set/queryable';
import { QueryOptions, QueryStack, Statement } from './query';
import { StackValue } from './query/types';

/**
 * Proxies calls to another EntitySet. Useful for overriding and intercepting certain calls
 */
export class ProxyEntitySet extends QueryableEntitySet {
    es: QueryableEntitySet;

    type!: string;
    isProxyEntitySet!: boolean;

    constructor(es: QueryableEntitySet, options: EntitySetOptions = {}) {
        super(undefined, options);
        this.es = es;
    }
    getUrl() {
        return `es://${this.type}/?uuid=${this.uuid}`;
    }

    async size(): Promise<number> {
        return this.es.size();
    }

    async clone(options: CloneOptions = {}): Promise<EntitySet> {
        const result = new ProxyEntitySet((await this.es.clone()) as QueryableEntitySet);
        return result;
    }

    select(stack: QueryStack, query: StackValue[], options: SelectOptions): Promise<StackValue[]> {
        return this.es.select(stack, query, options);
    }

    prepare(q: string, options?: QueryOptions): Statement {
        return this.es.prepare(q, options);
    }

    query(q: string, options?: QueryOptions): Promise<QueryStack> {
        return this.es.query(q, options);
    }

    queryEntities(q: string, options?: QueryOptions): Promise<Entity[]> {
        return this.es.queryEntities(q, options);
    }

    async register(value: ComponentDef | ComponentDefObj | any): Promise<ComponentDef> {
        return this.es.register(value);
    }

    async getComponentDefs(): Promise<ComponentDef[]> {
        return this.es.getComponentDefs();
    }

    async getComponent(id: ComponentId | Component): Promise<Component> {
        return this.es.getComponent(id);
    }

    async removeComponent(item: RemoveType, options: AddOptions = {}): Promise<EntitySet> {
        return this.es.removeComponent(item, options);
    }

    async removeComponents(items: RemoveType[], options: AddOptions = {}): Promise<EntitySet> {
        return this.es.removeComponents(items, options);
    }

    async removeEntity(item: RemoveEntityType, options: AddOptions = {}): Promise<EntitySet> {
        return this.es.removeEntity(item, options);
    }

    getComponents(): AsyncGenerator<Component, void, void> {
        return this.es.getComponents();
    }

    getEntities() {
        return this.es.getEntities();
    }

    async getEntity(eid: EntityId, populate = true): Promise<Entity> {
        return this.es.getEntity(eid, populate);
    }

    addComponents(components: Component[], options?: AddOptions): Promise<EntitySet> {
        return this.es.addComponents(components, options);
    }

    applyRemoveChanges(): Promise<EntitySet> {
        return this.es.applyRemoveChanges();
    }

    async markEntityComponentsRemove(eids: EntityId[]): Promise<EntitySet> {
        return this.es.markEntityComponentsRemove(eids);
    }

    createComponent(defId: string | number | ComponentDef, attributes = {}): Component {
        return this.es.createComponent(defId, attributes);
    }
}

ProxyEntitySet.prototype.type = 'proxy';
ProxyEntitySet.prototype.isProxyEntitySet = true;
