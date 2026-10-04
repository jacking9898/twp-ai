// SPDX-License-Identifier: MPL-2.0
// OpenCV 4.10's embind glue generates four kinds of wrappers at runtime.
// Equivalent closures avoid unsafe-eval without changing the extension CSP.
module.exports = function opencvCsp(source) {
  const named = /function createNamedFunction\(name,body\)\{[\s\S]*?\}function extendError/;
  const dyn = /function makeDynCaller\(dynCall\)\{[\s\S]*?\}var fp;/;
  const invoker = /function craftInvokerFunction\(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc\)\{[\s\S]*?\}function heap32VectorToArray/;
  const method = /function __emval_get_method_caller\(argCount,argTypes\)\{[\s\S]*?\}function __emval_get_property/;
  if (![named, dyn, invoker, method].every(pattern => pattern.test(source))) throw new Error('OpenCV glue changed; review the CSP adapter before building.');
  const result = source.replace(named, `function createNamedFunction(name,body){
    var fn=function(){"use strict";return body.apply(this,arguments);};
    Object.defineProperty(fn,"name",{value:makeLegalFunctionName(name),configurable:true});return fn;
  }function extendError`).replace(dyn, `function makeDynCaller(dynCall){
    var count=signature.length-1;
    var fn=function(){var args=[rawFunction];for(var i=0;i<count;i++)args.push(arguments[i]);return dynCall.apply(undefined,args);};
    Object.defineProperty(fn,"name",{value:"dynCall_"+signature+"_"+rawFunction,configurable:true});
    Object.defineProperty(fn,"length",{value:count,configurable:true});return fn;
  }var fp;`).replace(invoker, `function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){
    var count=argTypes.length;if(count<2)throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!");
    var method=argTypes[1]!==null&&classType!==null;
    var needsStack=argTypes.slice(1).some(function(type){return type!==null&&type.destructorFunction===undefined;});
    var fn=function(){
      if(arguments.length!==count-2)throwBindingError('function '+humanName+' called with '+arguments.length+' arguments, expected '+(count-2)+' args!');
      var stack=needsStack?[]:null,wired=[cppTargetFunc];
      if(method)wired.push(argTypes[1].toWireType(stack,this));
      for(var i=2;i<count;i++)wired.push(argTypes[i].toWireType(stack,arguments[i-2]));
      var rv=cppInvokerFunc.apply(undefined,wired);
      if(needsStack)runDestructors(stack);
      else for(var i=method?1:2;i<count;i++)if(argTypes[i].destructorFunction!==null)argTypes[i].destructorFunction(wired[method?i:i-1]);
      if(argTypes[0].name!=="void")return argTypes[0].fromWireType(rv);
    };
    Object.defineProperty(fn,"name",{value:makeLegalFunctionName(humanName),configurable:true});
    Object.defineProperty(fn,"length",{value:count-2,configurable:true});return fn;
  }function heap32VectorToArray`).replace(method, `function __emval_get_method_caller(argCount,argTypes){
    var types=__emval_lookupTypes(argCount,argTypes),retType=types[0];
    var fn=function(handle,name,destructors,args){
      var values=[],offset=0;
      for(var i=1;i<argCount;i++){values.push(types[i].readValueFromPointer(args+offset));offset+=types[i].argPackAdvance;}
      var rv=handle[name].apply(handle,values);
      for(var i=1;i<argCount;i++)if(types[i].deleteObject)types[i].deleteObject(values[i-1]);
      if(!retType.isVoid)return retType.toWireType(destructors,rv);
    };
    return __emval_addMethodCaller(fn);
  }function __emval_get_property`);
  if (/\bnew\s+Function\s*\(|\bnew_\s*\(\s*Function\b|\beval\s*\(/.test(result)) throw new Error('Unexpected dynamic code in OpenCV; refusing an incompatible build.');
  return result;
};
