const tools=[{id:'claude-code',name:'Claude Code',capabilities:{authentication:'official-cli',login:'default-browser',usage:'session-telemetry',resume:'native-session-id',additionalProjects:true,terminal:'embedded'}}];
const plannedTools=[{id:'codex-cli',name:'Codex CLI',status:'planned'},{id:'gemini-cli',name:'Gemini CLI',status:'planned'}];
function requireTool(id='claude-code'){
  const tool=tools.find(tool=>tool.id===id);if(!tool)throw new Error('该 Agent 工具尚未接入');return tool;
}
module.exports={tools,plannedTools,requireTool};
