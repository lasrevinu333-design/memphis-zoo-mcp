import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {deliverNativeMessageJob} from '../../src/native-message-dispatch.js';
import {deliverNativeEventJob} from '../../src/native-event-dispatch.js';
import {holdUnqualifiedNativeScheduleJob} from '../../src/native-schedule-job-preparation.js';
import {prepareNativeScheduleSourceJobs} from '../../src/native-schedule-source-producer.js';
// Actual worker body; only DB/auth imports, unrelated lanes and scheduler are
// synthetic. Both new alert owners and the existing Event formatter are real.
export async function qualifiedAlertDispatcher(f){
 let source=await readFile(new URL('../../src/employee-notifications.js',import.meta.url),'utf8');
 for(const line of ["import crypto from 'node:crypto';","import { isDeepStrictEqual } from 'node:util';",
  "import { createClient } from '@supabase/supabase-js';","import { makeDeviceCredentialMiddleware } from './auth/device-credential-auth.js';",
  "import { deliverNativeLocationJob } from './native-location-dispatch.js';","import { deliverNativeLunchJob } from './native-lunch-dispatch.js';",
  "import { deliverNativeMessageJob } from './native-message-dispatch.js';","import { deliverNativeEventJob } from './native-event-dispatch.js';",
  "import { holdUnqualifiedNativeScheduleJob } from './native-schedule-job-preparation.js';",
  "import { prepareNativeScheduleSourceJobs } from './native-schedule-source-producer.js';"]){
  if(source.split(line).length!==2)throw Error('exact worker import seam changed');source=source.replace(line,'');
 }
 if(/^import /m.test(source))throw Error('unaccounted worker dependency');source=source.replace(/^export /gm,'');
 const install=runInNewContext(source+'\ninstallEmployeeNotificationRoutes;',{
  crypto,isDeepStrictEqual,structuredClone,process:{pid:1,env:{}},console,
  createClient(){throw Error('No real environment DB allowed');},makeDeviceCredentialMiddleware(){return()=>{};},
  deliverNativeLocationJob:()=>({unchanged:'location'}),deliverNativeLunchJob:()=>({unchanged:'lunch'}),
  deliverNativeMessageJob,deliverNativeEventJob,holdUnqualifiedNativeScheduleJob,prepareNativeScheduleSourceJobs,setInterval(){return{unref(){}};},
 });
 return install({use(){},get(){},post(){},delete(){}},{supabase:f.db,pushRuntime:f.pushRuntime});
}
