function ensureWorkspaceOrder(state){
  let sequence=0;
  for(const w of state.workspaces){if(!Number.isSafeInteger(w.createdOrder))w.createdOrder=++sequence;else sequence=Math.max(sequence,w.createdOrder);}
  for(const group of state.deletedWorkspaces||[]){
    const existing=state.workspaces.find(w=>w.id===group.workspace.id);
    if(existing)group.workspace.createdOrder=existing.createdOrder;
    else if(!Number.isSafeInteger(group.workspace.createdOrder))group.workspace.createdOrder=0;
  }
}
function nextWorkspaceOrder(state){return Math.max(0,...state.workspaces.map(w=>w.createdOrder||0),...(state.deletedWorkspaces||[]).map(g=>g.workspace.createdOrder||0))+1;}
module.exports={ensureWorkspaceOrder,nextWorkspaceOrder};
