import _ from 'underscore';


export default function copyEntity( registry, srcEntity, dstEntity, options={} ){
    let ii,len,component,srcComponent;
    let result = registry.createEntity();
    const returnChanges = options.returnChanges;
    const returnChanged = options.returnChanged;
    const deleteMissing = options.delete;
    let copyList = [];
    let dstHasChanged = false;

    if( !srcEntity ){
        return returnChanged ? [false,null] : null;
    }

    let srcComponents = srcEntity.getComponents();

    // copy over dst components to new instance
    if( dstEntity ){
        let dstComponents = dstEntity.getComponents();

        for(ii=0,len=dstComponents.length;ii<len;ii++){
            component = dstComponents[ii];
            srcComponent = srcEntity[component.name];

            if( deleteMissing ){
                if( !srcComponent ){
                    dstHasChanged = true;
                    continue;
                }
            }
            // if the src already has the same component, then don't copy
            if( srcComponent ){
                if( srcComponent.hash() == component.hash() ){
                    continue;
                } else {
                    dstHasChanged = true;
                }
            }
            else {
                result.addComponent( copyComponent(registry,component) );
            }
        }    
    }

    // iterate over src components, copying them to the result
    for(ii=0,len=srcComponents.length;ii<len;ii++){
        result.addComponent( copyComponent(registry, srcComponents[ii]) );
    }

    return returnChanged ? [result,dstHasChanged] : result;
}


export function copyComponent( registry, srcComponent, options ){
    let result = new srcComponent.constructor(srcComponent.attributes);
    result.id = srcComponent.id;
    result.name = srcComponent.name;
    result.setSchemaId( srcComponent.getSchemaId() );
    result.schemaUri = srcComponent.schemaUri;
    result.schemaHash = srcComponent.schemaHash;
    result.registry = registry;
    return result;
}