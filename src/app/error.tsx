'use client';
export default function ErrorPage({reset}:{error:Error&{digest?:string};reset:()=>void}){return <main className="shell"><div className="state error"><span>✳</span><h3>That didn’t load.</h3><p>The neighborhood is still here. Give it another try.</p><button className="button" onClick={()=>reset()}>Try again</button></div></main>}
