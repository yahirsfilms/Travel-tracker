// Reading and parsing a selected file must not leave the app permanently busy.
// This stage has no access to the notebook or persistence layer.
export async function readBackupFile(file,{timeoutMs=15000}={}){
 if(!file||typeof file.text!=='function')throw Error('Choose a JSON backup file.');
 if(!Number.isSafeInteger(file.size)||file.size<0||file.size>20e6)throw Error('Backup exceeds 20 MB or has an invalid size.');
 if(!file.size)throw Error('This backup file is empty. Your notebook is unchanged.');
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error('Invalid backup read timeout.');
 let timer;
 try{
  const text=await Promise.race([
   Promise.resolve().then(()=>file.text()),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Could not read this backup in time. Download it in Files and choose it again. Your notebook is unchanged.')),timeoutMs);}),
  ]);
  if(typeof text!=='string')throw Error('Could not read this backup. Your notebook is unchanged.');
  try{return JSON.parse(text);}catch{throw Error('This file is not valid JSON. Choose a complete Roam backup. Your notebook is unchanged.');}
 }finally{clearTimeout(timer);}
}
