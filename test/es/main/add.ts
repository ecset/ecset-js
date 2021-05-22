import { suite } from 'uvu';
import assert from 'uvu/assert';

import {
    bfToValues,
    buildEntitySet,
    ChangeSetOp,
    createEntitySet,
    Component,
    Entity,
    getChanges,
    getComponentDefId,
    isEntity,
    OrphanComponent,
    beforeEach,
} from '../helpers';
import { assertHasComponents } from '../../helpers/assert';




let test = suite('es/mem - adding');

test.before.each( beforeEach );

test('should ignore an entity without an id', async () => {
    let es = createEntitySet();
    let e = new Entity();

    es.add(e);

    assert.equal( await es.size(), 0 );
})

test('should ignore an entity with an id, but without any components', async () => {
    let es = createEntitySet();
    let e = new Entity(2);

    await es.add(e);

    assert.equal(await es.size(), 0);
});

test('adds an entity with components', async () => {
    let e: Entity;
    let [es, buildEntity] = await buildEntitySet();

    e = buildEntity(es, ({ component }) => {
        component('/component/channel', { name: 'chat' });
        component('/component/status', { status: 'inactive' });
        component('/component/topic', { topic: 'data-structures' });
    });

    // Log.debug('ok!', e );

    assert.equal( e.size, 3);

    await es.add(e);

    // Log.debug('es', es);

    assert.equal(await es.size(), 1);

    // get the entity added changes to find the entity id
    const [eid] = getChanges(es.entChanges, ChangeSetOp.Add);

    e = await es.getEntity(eid);

    // Log.debug( e );

    assertHasComponents(
        es,
        e,
        ["/component/channel", "/component/status", "/component/topic"]
    );
});

test('adds unqualified components from an entity', async () => {
    // Log.debug('registry', registry);
    let [es] = await buildEntitySet();

    let e = es.createEntity(3110);

    e.Channel = { name: 'discussion' };
    e.Status = { status:'inactive' };

    // you can do this, but the component will not be saved
    // todo : add checking
    e.Bogus = { msg:'nope' };

    await es.add(e);

    
    // Log.debug( eid, peid, pronounceableDecode(peid),  e );

    assert.equal(await es.size(), 1);

    let ese = await es.getEntity(3110);

    // bogus did not get saved
    assert.is( ese.Bogus, undefined );

    assert.equal( ese.Channel.name, 'discussion' );
    assert.equal( ese.Status.status, 'inactive' );

    ese.Channel.name = '(closed)';

    ese = await es.getEntity(3110);
    assert.equal( ese.Channel.name, 'discussion' );

    ese.Channel.name = '(closed)';

    await es.add(ese, {debug:true});
    ese = await es.getEntity(3110);
    assert.equal( ese.Channel.name, '(closed)' );

    // Log.debug( es );
});


test('adds a component', async () => {
    let [es] = await buildEntitySet();
    let com = es.createComponent('/component/channel', {name: 'chat'} );
    let evtAdded = false;
    let evtUpdated = false;

    es.on('/component/add', (...args) => {
        evtAdded = true;
    });
    
    es.on('/component/upd', (...args) => {
        evtUpdated = true;
    });

    await es.add( com );

    assert.equal( await es.size(), 1 );

    assert.ok( evtAdded );
    assert.ok( evtUpdated === false );

    const cid = getChanges( es.comChanges, ChangeSetOp.Add )[0];

    com = await es.getComponent( cid );
    
    assert.equal( com.name, 'chat' );

    // change component value
    evtAdded = false;
    evtUpdated = false;
    com = {...com, name:'business'};

    await es.add(com);

    assert.ok( evtAdded === false );
    assert.ok( evtUpdated );
    
    // update with same value
    evtAdded = false;
    evtUpdated = false;
    com = {...com, name:'business'};
    
    await es.add(com);
    
    assert.ok( evtAdded === false );
    assert.ok( evtUpdated === false );
});



test('updates a component', async () => {
    // Log.debug('registry', registry);
    let [es] = await buildEntitySet();
    let com = es.createComponent('/component/channel', { name: 'chat' });

    await es.add(com);

    assert.equal(await es.size(), 1);

    const cid = getChanges(es.comChanges, ChangeSetOp.Add)[0];

    com = await es.getComponent(cid);

    com.name = 'chat and laughter';

    es = await es.add(com);

    com = await es.getComponent(cid);

    assert.equal(com.name, 'chat and laughter');
});

test('adds a component with an entity id', async () => {
    let [es] = await buildEntitySet();
    let com = es.createComponent('/component/channel', { '@e': 23, name: 'discussion' });

    await es.add(com);

    assert.equal(await es.size(), 1);

    let e = await es.getEntity(23);

    // Log.debug( e );

    assertHasComponents(es, e, ['/component/channel']);

    com = e.getComponent(getComponentDefId(com));

    assert.equal(com.name, 'discussion');
});

test('adds a single entity from two different components', async () => {
    let [es] = await buildEntitySet();
    let coms = [
        es.createComponent('/component/channel', { name: 'discussion' }),
        es.createComponent('/component/status', { status: 'active' })
    ];

    await es.add(coms);
    assert.equal(await es.size(), 1);
});

test('adds a number of components of the same type', async () => {
    // let e:Entity;
    let coms: Component[];
    let [es] = await buildEntitySet();

    // create a number of components
    coms = ['chat', 'dev', 'politics'].map(name =>
        es.createComponent('/component/channel', { name }));

    await es.add(coms);

    assert.equal(await es.size(), 3);

    // Log.debug('stack', es )
});

test('overwrites an entity', async () => {
    let e: Entity;
    let [es, buildEntity] = await buildEntitySet();

    e = buildEntity(es, ({ component }) => {
        component('/component/channel', { name: 'chat' });
        component('/component/status', { status: 'inactive' });
        component('/component/topic', { topic: 'data-structures' });
    }, 15);


    await es.add(e);

    e = await es.getEntity(15);

    assert.ok(isEntity(e));

    e = buildEntity(es, ({ component }) => {
        component('/component/username', { name: 'alex' });
        component('/component/status', { status: 'inactive' });
        component('/component/channel_member', { channel: 3 });
    }, 15);

    // Log.debug('>----');

    await es.add(e);

    e = await es.getEntity(15);

    assertHasComponents(es, e,
        ['/component/username', '/component/status', '/component/channel_member']);

    const did = bfToValues(es.resolveComponentDefIds( ['/component/channel_member']))[0];
    let com = e.getComponent(did);

    assert.equal(com.channel, 3);
});



test('updates an entity', async () => {
    let [es] = await buildEntitySet();

    let com: OrphanComponent = { "@d": "/component/topic", topic: 'chat' };

    await es.add(com);

    const cid = getChanges(es.comChanges, ChangeSetOp.Add)[0];

    com = await es.getComponent(cid);

    com = { ...com, topic: 'discussion' };

    // Log.debug('🦄', 'updating here');

    await es.add(com);

    com = await es.getComponent(cid);

    // Log.debug('final com', com );

    assert.equal(com.topic, 'discussion');
});

test('passing an idgen', async () => {
    let id = 1234;
    const idgen = () => id++;

    let [es] = await buildEntitySet({idgen});

    let com: OrphanComponent = { "@d": "/component/topic", topic: 'chat' };

    await es.add(com);

    const e = await es.getEntity(1234);

    assert.ok( e !== undefined );
})

test.run();