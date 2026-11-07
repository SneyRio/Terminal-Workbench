const claudeCapabilities={authentication:'official-cli',login:'default-browser',usage:'session-telemetry',resume:'native-session-id',additionalProjects:true,terminal:'embedded'};
const cliCapabilities={authentication:'official-cli',login:'default-browser',usage:'none',resume:'new-process',additionalProjects:false,terminal:'embedded'};
const tools=[{id:'claude-code',name:'Claude Code',capabilities:claudeCapabilities},{id:'codex-cli',name:'Codex CLI',capabilities:cliCapabilities},{id:'qoder-cli',name:'Qoder CLI',capabilities:cliCapabilities},{id:'opencode',name:'OpenCode',capabilities:cliCapabilities}];
function requireTool(id='claude-code'){
  const tool=tools.find(tool=>tool.id===id);if(!tool)throw new Error('该 Agent 工具尚未接入');return tool;
}
module.exports={tools,requireTool};
