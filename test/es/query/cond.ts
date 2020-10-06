import { suite } from 'uvu';
import assert from 'uvu/assert';

import {
    AsyncInstResult,
    isComponentDef,
    parse,
    prep,
    QueryStack,
    StackValue,
    sv,
} from '../helpers';


let test = suite('es/query/mem - Conditions');

test.skip('evaluates a boolean condition', async () => {
    // WHAT to do - should list conditions be evaled?
    let [stack] = await prep(`
            [ 2 3 + ] ok define
            wet ok true cond
            // wet hot 2 3 == cond
        `);

    let result = stack.popValue();
    assert.equal(result, 'hot');
})

test('creates a ComponentDef', async () => {
    let [stack] = await prep(`[ /component/title, [text] ] !d`);

    // Log.debug( stack );

    let result = stack.popValue();

    // Log.debug( result );

    assert.ok(isComponentDef(result));
});


test.run();