import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){
 if(specifier==='cloudflare:workers')return{url:new URL('./mock-env.mjs',import.meta.url).href,shortCircuit:true};
 try{return next(specifier,context);}catch(e){if(specifier.startsWith('.')&&!/\.[a-z]+$/.test(specifier))return next(specifier+'.ts',context);throw e;}
}});
