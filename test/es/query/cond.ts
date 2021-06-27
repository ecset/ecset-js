import { suite } from 'uvu';
import assert from 'uvu/assert';

import { prep } from '../helpers';

const test = suite('es/mem/query - Conditions');

test('iif evaluates a boolean condition with a word result', async () => {
    // WHAT to do - should list conditions be evaled?
    const [stack] = await prep(`
            [ 2 3 + ] ok define
            wet ok true iif
        `);

    const result = stack.popValue();
    assert.equal(result, 5);
});

test('iif evaluates a boolean condition', async () => {
    // WHAT to do - should list conditions be evaled?
    const [stack] = await prep(`
            [ 2 3 ] 
            [ 10 2 ]
            [ intersect! pop! ] [ diff! pop! ] true iif
        `);

    const result = stack.popValue();
    assert.equal(result, 10);
});

test('if', async () => {
    const [stack] = await prep(`
    "even" 2 1 % 0 == if
    "odd" 2 1 % 0 != if
    `);

    assert.equal(stack.popValue(), 'even');
});

test('list values are pushed', async () => {
    const [stack] = await prep(`
        [ 19, 9 ] true if
    `);

    assert.equal(stack.popValue(), 9);
    assert.equal(stack.popValue(), 19);
});

test('can still produce a list', async () => {
    const [stack] = await prep(`
        [ [19, 9] ] true if
    `);

    assert.equal(stack.popValue(), [19, 9]);
});

test('and', async () => {
    const [stack] = await prep(`
         ok true true and if
         ok 6 4 > 5 10 < and if
         nok  ok  true false or iif
    `);
    assert.equal(stack.popValue(), 'ok');
    assert.equal(stack.popValue(), 'ok');
    assert.equal(stack.popValue(), 'ok');
});

test.run();
