import { EntitySet } from '.';
import { Entity } from '../entity';
import { QueryOptions, QueryStack, Statement } from '../query';
import { StackValue } from '../query/types';

export interface SelectOptions {
    isCount?: boolean;
    stack?: QueryStack;
}

export abstract class QueryableEntitySet extends EntitySet {
    abstract select(stack: QueryStack, query: StackValue[], options: SelectOptions): Promise<StackValue[]>;

    abstract prepare(q: string, options?: QueryOptions): Statement;

    abstract query(q: string, options?: QueryOptions): Promise<QueryStack>;

    abstract queryEntities(q: string, options?: QueryOptions): Promise<Entity[]>;
}
