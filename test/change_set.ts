import { suite } from 'uvu';
import assert from 'uvu/assert';

import { add, update, remove, getChanges, create as createChangeSet, ChangeSetOp } from '../src/entity_set/change_set';

describe('ChangeSet', () => {
    it('should return a unique list of changes', () => {
        let ch = createChangeSet<number>();

        ch = add(ch, 2);
        ch = update(ch, 3);

        assert.deepEqual(getChanges(ch, ChangeSetOp.Add | ChangeSetOp.Update), [2, 3]);
        // console.log(getChanges(ch, ChangeSetOp.Add | ChangeSetOp.Update));

        // console.log( ch );
    });
});
