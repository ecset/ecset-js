require('./common');
var odgn = require('../index')();


describe('Entity', function(){
    beforeEach( function(done){
        var self = this;
        // passing a callback to create will initialise
        this.registry = odgn.entity.Registry.create({initialise:true}, function(err,registry){
            self.registry = registry;
            self.registry.registerComponent([ 
                "/component/test/a", "/component/test/b", "/component/test/c" 
            ], function(){
                done();    
            });
            
        });
    });

    describe('Entity', function(){
        it('should create a new entity with an id', function(done){
            var self = this;
            self.registry.createEntity(function(err,entity){
                assert( entity.id );
                done();
            });
        });
    });


    describe('Entity Components', function(){
        it('should add a component to an entity', function(done){
            var self = this, cEntity;
            async.waterfall([
                function(cb){
                    self.registry.createEntity(cb);
                },
                function(entity,cb){
                    cEntity = entity;
                    entity.addComponent("/component/test/b", cb);
                },
                function(component,cb){
                    assert( odgn.entity.Component.isComponent(component) );
                    self.registry.getEntitiesWithComponents("/component/test/b", cb);
                }
            ], function(err,entities){
                assert.equal( entities[0].id, cEntity.id );
                done();
            });
        });
    });

    /**
     * Entity Templates are recipes for creating
     * an entity with components
     */
    describe("Entity Templates", function(){

        it('create an entity from a template', function(done){
            var self = this;
            var entityTemplate = {
                "id":"/entity/template/example",
                "type":"object",
                "properties":{
                    "a":{ "$ref":"/component/tmpl/a" },
                    "c":{ "$ref":"/component/tmpl/c" },
                }
            };
            var entity;

            async.waterfall([
                function(cb){
                    self.registry.registerComponent([ "/component/tmpl/a", "/component/tmpl/b", "/component/tmpl/c" ], cb);
                },
                function(components, cb){
                    self.registry.registerEntityTemplate( entityTemplate, cb);
                },
                function( defs, cb ){
                    self.registry.createEntityFromTemplate( '/entity/template/example', cb );
                },
                function(result, cb){
                    entity = result;
                    // retrieve all the components for this entity
                    self.registry.getEntityComponents( entity, cb );
                },
            ], function(err, components){
                assert.equal( components[0].schemaId, '/component/tmpl/a' );
                assert.equal( components[1].schemaId, '/component/tmpl/c' );
                done();  
            });
        });
    });
});