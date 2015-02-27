var _ = require('underscore');
var test = require('tape');

var Common = require('./common');


var Es = require('event-stream');
var Sinon = require('sinon');
var Promise = require('bluebird');

var Elsinore = require('../lib');

var EntityFilter = Elsinore.EntityFilter;
var EntitySet = Elsinore.EntitySet;
var Entity = Elsinore.Entity;
var Registry = Elsinore.Registry;
var Utils = Elsinore.Utils;


test('adding a component without an id or an entity id creates a new component and a new entity', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var eventSpy = Sinon.spy();
    // Common.logEvents( entitySet );

    entitySet.on('all', eventSpy);
    entitySet.addComponent( registry.createComponent( '/component/position', {x:15,y:2}) );

    t.ok( eventSpy.calledWith('entity:add'), 'entity:add should have been called');
    // t.ok( entitySet.doesEntityHaveComponent( 0, '/component/position' ), 'the entity should have a Position component' );
    t.notStrictEqual( entitySet.atSync(0).Position, undefined, 'the entity should have the Position component as a property' );
    // t.ok( entitySet.atSync(0).hasComponent( '/component/position' ), 'the entity should have a Position component' );

    t.end();
});


test('you cant add an empty entity to an entityset', function(t){
    var registry = initialiseRegistry(true);
    var entitySet = registry.createEntitySet();

    var e = Entity.create( 43 );

    entitySet.add( e );

    t.equals( entitySet.size(), 0 );
    // log.debug('entitySet id is ' + entitySet.id );
    // printE( entitySet );

    // t.equals( entitySet.atSync(0).getEntityId(), 43 );
    // t.equals( entitySet.atSync(0).getEntitySetId(), 1 );

    t.end();
});

test('adding several components without an entity adds them to the same new entity', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var eventSpy = Sinon.spy();
    // Common.logEvents( entitySet );

    // return registerComponents().then(function(){
        // var eventSpy = Sinon.spy();
        entitySet.on('all', eventSpy);
        // logEvents( entitySet );
        entitySet.addComponent( [
            registry.createComponent( '/component/flower', {colour:'yellow'}),
            registry.createComponent( '/component/radius', {radius:2.0} )
            ]);

        t.ok( eventSpy.calledWith('entity:add'), 'entity:add should have been called');
        t.notStrictEqual( entitySet.atSync(0).Flower, undefined, 'the entity should have a Flower component' );
        t.notStrictEqual( entitySet.atSync(0).Radius, undefined, 'the entity should have a Radius component' );

        return t.end();
    // });
});

test('adding a component generates events', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var eventSpy = Sinon.spy();
    // Common.logEvents( entitySet );
    
    entitySet.on('all', eventSpy);

    entitySet.addComponent(
        registry.createComponent( '/component/position', {id:160,_e:15, x:0, y:20}) );

    t.ok( eventSpy.calledWith('component:add'), 'component:add should have been called' );
    t.ok( eventSpy.calledWith('entity:add'), 'entity:add should have been called' );
    
    t.end();
});

test('adding several components at once generates a single add event', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var eventSpy = Sinon.spy();
    // Common.logEvents( entitySet );
    entitySet.on('all', eventSpy);

    entitySet.addComponent( [
        registry.createComponent( '/component/position', {id:1,_e:2, x:19, y:-2}),
        registry.createComponent( '/component/nickname', {id:2,_e:2, nick:'isaac'})
    ]);

    t.equals( eventSpy.callCount, 2, 'two events should have been emitted' );
    t.ok( eventSpy.calledWith('component:add'), 'component:add should have been called' );
    t.ok( eventSpy.calledWith('entity:add'), 'entity:add should have been called' );
    // t.equals( eventSpy.args[1][1].length, 2, 'should contain an array of components added' );

    t.end();
    // });
    
});


test('adding an entity with components', function(t){
    var com;
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var eventSpy = Sinon.spy();
    // Common.logEvents( entitySet );

        entitySet.on('all', eventSpy);

        var entity = Entity.create(16);
        entity.addComponent( (com=registry.createComponent( '/component/position', {id:5, x:2,y:-2})) );
        entity.addComponent( registry.createComponent( '/component/score', {id:6, score:100}) );
        entitySet.add( entity );

        t.equals( eventSpy.callCount, 2, 'four events should have been emitted' );
        // printE( entitySet );
        t.equals( entitySet.atSync(0).Position.get('x'), 2 );

        t.end();
    // });
});



test('should return the number of entities contained', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var eventSpy = Sinon.spy();
    // Common.logEvents( entitySet );

        var pos = registry.createComponent( '/component/position', {id:1,_e:3});
        var nick = registry.createComponent( '/component/nickname', {id:2,_e:3});

        t.ok( pos.getEntityId(), 3 );
        t.ok( nick.getEntityId(), 3 );
        
        entitySet.addComponent( pos );

        t.equals( entitySet.size(), 1, 'should only be one entity' );

        entitySet.addComponent( nick );
        t.equals( entitySet.size(), 1, 'should only be one entity' );

        // retrieve an entity by id 3
        var entity = entitySet.getEntity(3);
        
        t.ok( entity.Position, 'entity should have position' );
        t.ok( entity.Nickname, 'entity should have nickname' );
        t.end();
    // });
});


test('should return an added entity', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var eventSpy = Sinon.spy();

    var entities = loadEntities( registry );  

    // printE( entities );

    var entity = entities.atSync(0);
    entitySet.addComponent( entity.Position );
    var addedEntity = entitySet.atSync(0);
    t.equals( addedEntity.getEntityId(),  entity.getEntityId() );
    t.equals( addedEntity.Position.id,  entity.Position.id );
    t.end();
});

test('should remove the entities component', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var eventSpy = Sinon.spy();

    var entity = Entity.create(9);
    entity.addComponent( registry.createComponent( '/component/realname', {id:3, name:'tom smith'}) );

    entitySet.addComponent( entity.Realname );
    entitySet.removeComponent( entity.Realname );

    t.equals( entitySet.size(), 1, 'the entityset should still have the single entity')
    t.notOk( entitySet.atSync(0).hasComponents(), 'the single entity should have no components' );

    t.end();
});

test('should remove the entity belonging to a component', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet({allowEmptyEntities:false});
    var eventSpy = Sinon.spy();

    var entity = Entity.create(9);
    entity.addComponent( registry.createComponent( '/component/realname', {id:3, name:'tom smith'}) );

    entitySet.addComponent( entity.Realname );
    entitySet.removeComponent( entity.Realname );

    t.equals( entitySet.size(), 0, 'the entityset should have no entities')
    t.end();
});

// test.skip('sanity check', function(t){
//     return beforeEach().then( function(){

//         registry.on('all', function(evt){
//             log.debug('evt ' + JSON.stringify( _.toArray(arguments) ) );
//         });

//         return registry.createComponent([
//             {_e:10, _s:'position', x:1.2, y:2},
//             {_e:10, _s:'score', score:22 }
//         ]).then(function(coms){
//             print_ins( coms );
//             t.end();
//         });
//     });
// });

test('should remove a component reference from an entity', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var eventSpy = Sinon.spy();

    var entities = loadEntities( registry );

        var entity = entities.atSync(0);
        
        entitySet.addComponent( [entity.Position, entity.Nickname, entity.Realname] );
        var addedEntity = entitySet.atSync(0);

        t.ok( addedEntity.Realname !== undefined, 'the entity should have the Realname component' );
        
        entitySet.removeComponent( entity.Realname );
        
        addedEntity = entitySet.atSync(0);
        
        t.ok( addedEntity.Realname === undefined, 'the entity should not have the Realname component' );
        t.end();
    // });
});

test('should add an entity', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var eventSpy = Sinon.spy();

    var entities = loadEntities( registry );  

        var entity = entities.atSync(0);
        entitySet.add( entity );
        t.equals( entitySet.size(), 1);
        entitySet.add( entity );
        t.equals( entitySet.size(), 1);
        t.end();
    // });
});


test('should remove an entity', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var eventSpy = Sinon.spy();

    var entities = loadEntities( registry );  

    var entity = entities.atSync(0);
    entitySet.add( entity );
    t.equals( entitySet.size(), 1);

    // log.debug('>----- from here');
    entitySet.remove( entity );
    t.equals( entitySet.size(), 0);
    t.end();
});

test('should add the components of an entity', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var eventSpy = Sinon.spy();

    var entities = loadEntities( registry );

    entitySet.add( entities.atSync(0) );
    
    var addedEntity = entitySet.atSync(0);
    t.notEqual( addedEntity.Realname, undefined );
    t.end();
});

test('should emit an event when an entity is added', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var eventSpy = Sinon.spy();

    var entities = loadEntities( registry );
        
    entitySet.on('entity:add', eventSpy );
    entitySet.add( entities.atSync(0) );
    
    t.ok( eventSpy.called, 'entity:add should have been called' );
    t.end();
});

test('should emit an event when an entity is removed', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var eventSpy = Sinon.spy();

    var entities = loadEntities( registry );
    var entity = entities.atSync(0);
        
    entitySet.on('entity:remove', eventSpy );
    entitySet.add( entity );
    entitySet.remove( entity );

    t.ok( eventSpy.called, 'entity:remove should have been called' );
    t.end();
});



test('should only add an entity with components', function(t){
    var entitySet = EntitySet.create({allowEmptyEntities:false});
        entitySet.add( 345 );
        t.equals( entitySet.size(), 0);
        t.end();
});

test('should only add a component of an accepted type', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var eventSpy = Sinon.spy();
    // Common.logEvents( entitySet );
    var entities = loadEntities( registry );

    // printE( entities );
    // setting an entity filter means that the entitySet will
    // only add components that pass through the filter
    EntitySet.setEntityFilter( entitySet, EntityFilter.ALL, '/component/position' );

    // entitySet.add( entities.atSync(1) );
    // t.equals( entitySet.size(), 0);
    
    entitySet.add( entities.atSync(0) );
    t.equals( entitySet.size(), 1);
    t.end();
});


test('should only retain the included component on entity', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var entities = loadEntities( registry );

        EntitySet.setEntityFilter( entitySet, EntityFilter.INCLUDE, '/component/nickname' );
        entitySet.add( entities.atSync(0) );
        // the entity won't have any of the other components
        t.equals( entitySet.atSync(0).getComponentCount(), 1);
        t.end();
    // });
});

test('should not add entities that have excluded components', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var entities = loadEntities( registry );

        EntitySet.setEntityFilter( entitySet, EntityFilter.NONE, '/component/score' );

        entitySet.add( entities.atSync(1) );
        t.equals( entitySet.size(), 0);
        entitySet.add( entities.atSync(0) );
        t.equals( entitySet.size(), 1);
        t.end();
    // });
});

test('should not add entities that have multiple excluded components', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var entities = loadEntities( registry );

    EntitySet.setEntityFilter( entitySet, EntityFilter.NONE, '/component/score','/component/nickname' );
    entitySet.add( entities );
    t.equals( entitySet.size(), 1);
    t.end();
});

test('should only add entities that are included', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var entities = loadEntities( registry );

        // this means that any entity MUST have a Position and Nickname
        EntitySet.setEntityFilter( entitySet, EntityFilter.ALL, '/component/position','/component/nickname' );
        entitySet.add( entities );
        t.equals( entitySet.size(), 2);
        t.end();
    // });
});

test('should only add entities that are optional', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var entities = loadEntities( registry );

        // this means that the entity MAY have Position and/or Nickname
        EntitySet.setEntityFilter( entitySet, EntityFilter.ANY, '/component/position','/component/nickname' );
        entitySet.add( entities );
        t.equals( entitySet.size(), 4);
        t.end();
    // });
});


test('should only add entities that pass include/exclude', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var entities = loadEntities( registry );

    EntitySet.setEntityFilter( entitySet, 
        [EntityFilter.ALL, '/component/position'],
        [EntityFilter.NONE, '/component/realname'] );

    entitySet.add( entities );

    t.equals( entitySet.size(), 1);
    t.end();
});

test('should remove entities that are excluded after their components change', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet({allowEmptyEntities:false});
    var entities = loadEntities( registry );

        EntitySet.setEntityFilter( entitySet, EntityFilter.NONE, '/component/realname' );
        entitySet.add( entities );
        t.equals( entitySet.size(), 2);
        
        var entity = entities.atSync(1);
        var component = registry.createComponent( '/component/realname', {name:'mike smith', _e:entity.getEntityId()});
        // this action should cause the entity to be removed
        entitySet.addComponent( component );
        t.equals( entitySet.size(), 1);

        t.end();
    // });
});

test('should remove entities that no longer included after their components change', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var entities = loadEntities( registry );

        EntitySet.setEntityFilter( entitySet, EntityFilter.ALL,'/component/nickname' );
        entitySet.add( entities );
        
        t.equals( entitySet.size(), 3, 'two entities which have Nickname');
        var entity = entities.atSync(0);

        // removing the Nickname component should mean the entity is also removed
        entitySet.removeComponent( entity.Nickname );
        t.equals( entitySet.size(), 2);
        t.end();
    // });
});

test('should remove entities that are no longer allowed when the component mask changes', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var entities = loadEntities( registry );
        
        entitySet.add( entities );
        t.equals( entitySet.size(), 5);

        EntitySet.setEntityFilter( entitySet, EntityFilter.NONE,'/component/score' );
        t.equals( entitySet.size(), 2);
        t.end();
    // });
});

test('should filter', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var entities = loadEntities( registry );

    var positionIId = registry.getIId( '/component/position' );
        
    entitySet.add( entities );

    var selected = entitySet.filter( function(e){
        return e.getComponentBitfield().get( positionIId );
    });

    t.equals( selected.length, 3);
    t.end();
});

// test('should remove components for an entity', function(t){
//     return beforeEach(true).then( function(){
//         var entity = entities.atSync(0);

//         entitySet.add( entity );
//         entitySet.remove( entity );
//         t.end();
//     });
// });

test('should emit an event when a component is changed', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var entities = loadEntities( registry );
    // Common.logEvents( entitySet );

        var entity = entities.atSync(0);
        var component = entity.Position;
        var spy = Sinon.spy();

        entitySet.on('component:change', spy);

        entitySet.add( entity );

        component = entitySet.cloneComponent( component );
        component.set({x:0,y:-2});

        entitySet.addComponent( component );

        t.ok( spy.called, 'component:change should have been called' );
        t.end();
    // });
});

// NOTE - don't think this is needed? 
test.skip('should emit events when components change', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var entities = loadEntities( registry );

        var entity = entities.atSync(0);
        var spy = Sinon.spy();

        entitySet.on('component:change', spy);
        
        entitySet.add( entity );
        entity.Position.set('x',100);

        t.ok( spy.called, 'component:change should have been called' );
        t.end();
    // });
});


test('should clear all contained entities by calling reset', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var entities = loadEntities( registry );

    var spy = Sinon.spy();

    entitySet.on('reset', spy);
    entitySet.add( entities );
    t.equals( entitySet.size(),  entities.size() );

    entitySet.reset(null);
    t.equals( entitySet.size(), 0);
    t.ok( spy.called, 'reset should have been called' );
    t.end();
});


test('attached entitysets', function(t){
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var entities = loadEntities( registry );
    
    // other ES will accept only entities with Position and Realname
    var oEntitySet = registry.createEntitySet();
        EntitySet.setEntityFilter( oEntitySet, EntityFilter.ALL, '/component/position','/component/realname' );

        oEntitySet.attachTo( entitySet );

        entitySet.add( entities.atSync(0) );
        entitySet.add( entities.atSync(4) );

        // these added entities should end up in the other entityset
        t.equals( oEntitySet.size(), 2 );

        t.end();
    // });
});


test('map transfers an entitySet through a filter into another entityset', function(t){
    var eventSpy = Sinon.spy();
    var registry = initialiseRegistry();
    var loadedEntitySet = loadEntities( registry );
    var oEntitySet = registry.createEntitySet();
    var entityFilter = registry.createEntityFilter( EntityFilter.INCLUDE, '/component/score' );

    oEntitySet.on('all', eventSpy);

    // Common.logEvents( oEntitySet );
    // map the entities from the loaded set into the other set, using the entityfilter
    EntitySet.map( loadedEntitySet, entityFilter, oEntitySet );
    // loadedEntitySet.map( entityFilter, oEntitySet );

    t.equal( _.size(eventSpy.args[1][1]), 3, 'three components reported as being added' );
    t.equal( _.size(eventSpy.args[2][1]), 3, 'three entities reported as being added' );

    t.end();
});


test('map transfers an entitySet through a filter into another entityset again', function(t){
    var eventSpy = Sinon.spy();
    var registry = initialiseRegistry();
    var loadedEntitySet = loadEntities( registry );
    var oEntitySet = registry.createEntitySet();
    var entityFilter = registry.createEntityFilter( EntityFilter.NONE, '/component/position' );

    oEntitySet.on('all', eventSpy);

    // Common.logEvents( oEntitySet );
    // map the entities from the loaded set into the other set, using the entityfilter
    EntitySet.map( loadedEntitySet, entityFilter, oEntitySet );
    // loadedEntitySet.map( entityFilter, oEntitySet );

    t.equal( _.size(eventSpy.args[1][1]), 3, 'three components reported as being added' );
    t.equal( _.size(eventSpy.args[2][1]), 2, 'two entities reported as being added' );

    t.end();
});

test.skip('iterator', function(t){
    var it, entity, count;
    var registry = initialiseRegistry();
    var entitySet = registry.createEntitySet();
    var entities = loadEntities( registry );


    entitySet.add( entities );
    entitySet.remove( entities.atSync(3) );
    count = 0;

    for( entity of entitySet ){
        count++;
    }
    
    t.equals( count, 4, 'four entities should have been returned' );

    t.end();
});

// test('async iterator completest with a rejection', function(t){
//     var it, entity, count;
//     var registry = initialiseRegistry();
//     var entitySet = registry.createEntitySet();
//     var entities = loadEntities( registry );

//     // add a single entity
//     entitySet.add( entities.atSync(0) );

//     it = entitySet.iterator();

//     // the first call will return the entity
//     it.next().then( function(e){
//         // the second call should be rejected
//         it.next().then( null, function(state){
//             t.ok( state.done, true, 'the state should be done' );
//             t.end();
//         })
//     });
// });

// test('async iterator', function(t){
//     var it, entity, count;
//     var registry = initialiseRegistry();
//     var entitySet = registry.createEntitySet();
//     var entities = loadEntities( registry );

//     entitySet.add( entities );

//     entitySet.remove( entities.atSync(3) );

//     count = 0;

//     it = entitySet.iterator();

//     return Utils.reduceIterator( it, function(memo,item){
//         memo.push( item );
//         // printE( item );
//     }, [] )
//     .then( function(results){
//         // printE( results );
//         t.equals( results.length, 4, 'four entities should have been returned' );
//         t.end();
//     });
// });


/**
*   Returns an entityset with the given entities
*/
function loadEntities( registry, fixtureName ){
    var data;
    var lines;
    var result;

    fixtureName = fixtureName || 'entity_set.entities.ldjson';

    result = registry.createEntitySet();
    data = Common.loadFixture( fixtureName );
    lines = data.split(/\r\n|\r|\n/g);

    _.map( _.compact( lines ), function(line){
        line = JSON.parse( line );
        var com = registry.createComponent( line );
        result.addComponent( com );
        return com;
    });

    return result;
}



function initialiseRegistry(logEvents){
    var componentData;
    var registry = Registry.create();
    // ComponentDefs = registry.ComponentDef;
    if( logEvents ){
        Common.logEvents( registry );
    }
    
    componentData = Common.loadComponents();
    registry.registerComponent( componentData );

    return registry;
}
