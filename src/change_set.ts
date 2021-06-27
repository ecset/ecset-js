export enum ChangeSetOp {
    None = 0,
    Add = 1 << 0,
    Update = 1 << 1,
    Remove = 1 << 2,
    All = (1 << 0) | (1 << 1) | (1 << 2),
}

export interface ChangeSet<T> {
    added: Set<T>;
    updated: Set<T>;
    removed: Set<T>;
}

export function create<T>(set?: ChangeSet<T>): ChangeSet<T> {
    return {
        added: new Set<T>(set !== undefined ? set.added : undefined),
        updated: new Set<T>(set !== undefined ? set.updated : undefined),
        removed: new Set<T>(set !== undefined ? set.removed : undefined),
    };
}

export function getChanges<T>(set: ChangeSet<T>, ops: ChangeSetOp = ChangeSetOp.All): Array<T> {
    let result = new Set<T>();
    if ((ops & ChangeSetOp.Add) === ChangeSetOp.Add) {
        result = new Set([...set.added]);
    }
    if ((ops & ChangeSetOp.Update) === ChangeSetOp.Update) {
        result = new Set([...result, ...set.updated]);
    }
    if ((ops & ChangeSetOp.Remove) === ChangeSetOp.Remove) {
        result = new Set([...result, ...set.removed]);
    }
    return [...result];
}

export function find<T>(set: ChangeSet<T>, val: T): ChangeSetOp {
    let op = ChangeSetOp.None;
    if (set.added.has(val)) {
        op |= ChangeSetOp.Add;
    }
    if (set.updated.has(val)) {
        op |= ChangeSetOp.Update;
    }
    if (set.removed.has(val)) {
        op |= ChangeSetOp.Remove;
    }
    return op;
}

export function merge<T>(a: ChangeSet<T>, b: ChangeSet<T>): ChangeSet<T> {
    const added = new Set([...a.added, ...b.added]);
    const removed = new Set([...a.removed, ...b.removed]);
    const updated = new Set([...a.updated, ...b.updated]);
    for (const val of updated) {
        if (removed.has(val)) {
            removed.delete(val);
        }
    }

    // if a value is in added and also in removed, changed to updated
    for (const val of added) {
        if (removed.has(val)) {
            removed.delete(val);
            added.delete(val);
            updated.add(val);
        }
    }

    return { added, updated, removed };
}

export function add<T>(set: ChangeSet<T>, val: T): ChangeSet<T> {
    const added = new Set(set.added).add(val);
    const updated = new Set(set.updated);
    updated.delete(val);
    const removed = new Set(set.removed);
    removed.delete(val);

    return { added, updated, removed };
}

export function update<T>(set: ChangeSet<T>, val: T): ChangeSet<T> {
    if (set.added.has(val)) {
        return set;
    }

    const added = new Set(set.added);
    added.delete(val);
    const updated = new Set(set.updated);
    updated.add(val);
    const removed = new Set(set.removed);
    removed.delete(val);

    return { added, updated, removed };
}

export function remove<T>(set: ChangeSet<T>, val: T): ChangeSet<T> {
    const added = new Set(set.added);
    added.delete(val);
    const updated = new Set(set.updated);
    updated.delete(val);
    const removed = new Set(set.removed);
    removed.add(val);

    return { added, updated, removed };
}
