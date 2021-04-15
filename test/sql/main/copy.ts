import { suite } from 'uvu';
import assert from 'uvu/assert';

import {
    buildComponents,
    createEntitySet,
    beforeEach,
    prepES,
} from '../helpers';

let test = suite('es/sqlite - copying');




test.before.each( beforeEach );


// NOTE - cloning of file backed sqlite currently not
// implemented. 
// requires either multiple es within a db
// OR creation of a new db file
test.skip('cloning without entities', async () => {
    let [,es] = await prepES(undefined, 'todo');

    let es2 = await es.clone({cloneEntities:false});

    // console.log('es1', es.getUrl());
    // console.log('es2', es2.getUrl());

    assert.equal( (await es2.getComponentDefs()).length, 4 );
    assert.equal( (await es2.size() ), 0 );
});


test('transfers components to a foreign es', async () => {
    // create es1 with defs and components
    // create es2 with different defs
    // copy es1 into es2

    const defsA = [
        { uri: '/component/status', properties: ['status'] },
        { uri: '/component/topic', properties: ['topic'] },
        { uri: '/component/channel', properties: ['name'] },
        { uri: '/component/username', properties: ['username'] },
        { uri: '/component/channel_member', properties: ['channel_member'] },
    ];
    const defsB = [
        { uri: '/component/topic', properties: ['topic'] },
        { uri: '/component/channel', properties: ['name', {name:'isOpen', type:'boolean'}] },
        { uri: '/component/status', properties: ['status', {name:'isActive',type:'boolean'}] },
    ];

    let es1 = createEntitySet();
    let es2 = createEntitySet();

    for( const def of defsA ){
        await es1.register(def);
    }
    for( const def of defsB ){
        await es2.register(def);
    }


    let data:any = [ 
        {uri:'/component/status', status:'active'},
        {uri:'/component/topic', topic:'current affairs'},
        {uri:'/component/channel', name:'#current-affairs'},
        {uri:'/component/username', username:'melliott'},
    ];
    let coms = buildComponents(es1, data);
    await es1.add(coms);

    // console.log('\nes1');
    // await printAll( es1 );

    data = [
        {uri:'/component/status', status:'inactive', isActive:false },
        {uri:'/component/topic', topic:'Off Topic'},
        {uri:'/component/channel', name:'#off-topic', isOpen:true },
    ]
    coms = buildComponents(es2, data);
    
    await es2.add(coms);
    // console.log('\nes2');
    // await printAll( es2 );

    
    // console.log('\n>---');
    await es2.add(es1, {debug:true});
    
    // console.log('\nes1');
    // await printAll( es1 );
    // console.log('\nes2');
    // await printAll( es2 );
    // Log.debug(es2);

    // Log.debug('[TF]', 'es1 size', await es1.size() );
    // Log.debug('[TF]', 'es2 size', await es2.size() );

    // two entities, because the components have different signatures
    assert.equal( await es2.size(), 2 );
});


test.run();