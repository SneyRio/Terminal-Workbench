using System;
using System.IO;
using System.Text;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Web.Script.Serialization;
public class WindowsCliFixture {
 static JavaScriptSerializer Json=new JavaScriptSerializer();
 static string Root,Config,Sid,Transcript;static Dictionary<string,object> Settings;static int CancelCount=0;
 static void Write(string file,object value){var name=Path.Combine(Root,file);Directory.CreateDirectory(Root);File.WriteAllText(name,Json.Serialize(value),new UTF8Encoding(false));}
 static string Quote(string value){return "\""+value.Replace("\"","\\\"")+"\"";}
 static void Event(string name){
  if(Settings==null||!Settings.ContainsKey("hooks"))return;
  var hooks=(Dictionary<string,object>)Settings["hooks"];if(!hooks.ContainsKey(name))return;
  var groups=(object[])hooks[name];var group=(Dictionary<string,object>)groups[0];var entries=(object[])group["hooks"];var hook=(Dictionary<string,object>)entries[0];
  var list=(object[])hook["args"];var args=new List<string>();foreach(var arg in list)args.Add(Quote(Convert.ToString(arg)));
  var start=new ProcessStartInfo(Convert.ToString(hook["command"]),String.Join(" ",args));start.UseShellExecute=false;start.CreateNoWindow=true;start.RedirectStandardInput=true;start.RedirectStandardOutput=true;start.RedirectStandardError=true;
  using(var process=Process.Start(start)){process.StandardInput.Write(Json.Serialize(new {hook_event_name=name,session_id=Sid,transcript_path=Transcript,cwd=Directory.GetCurrentDirectory(),prompt="Windows session fixture"}));process.StandardInput.Close();if(!process.WaitForExit(10000)){process.Kill();throw new Exception("Hook timeout");}if(process.ExitCode!=0)throw new Exception("Hook process failed");}
 }
 static void RunHud(){if(Settings==null||!Settings.ContainsKey("statusLine"))return;var setting=(Dictionary<string,object>)Settings["statusLine"];var command=Convert.ToString(setting["command"]);if(!command.StartsWith("powershell.exe "))throw new Exception("Expected encoded PowerShell HUD launcher");var start=new ProcessStartInfo("powershell.exe",command.Substring("powershell.exe ".Length));start.UseShellExecute=false;start.CreateNoWindow=true;start.RedirectStandardInput=true;start.RedirectStandardOutput=true;start.RedirectStandardError=true;using(var process=Process.Start(start)){process.StandardInput.Write(Json.Serialize(new {session_id=Sid,rate_limits=new {five_hour=new {used_percentage=12},seven_day=new {used_percentage=25}}}));process.StandardInput.Close();var text=process.StandardOutput.ReadToEnd();if(!process.WaitForExit(10000)){process.Kill();throw new Exception("HUD timeout");}Write("hud.json",new {text=text,exitCode=process.ExitCode});}}
 public static int Main(string[] args){
  Console.OutputEncoding=new UTF8Encoding(false);Console.InputEncoding=new UTF8Encoding(false);Root=Environment.GetEnvironmentVariable("WB_WINDOWS_FIXTURE_DIR");if(String.IsNullOrEmpty(Root))return 2;
  Config=Environment.GetEnvironmentVariable("CLAUDE_CONFIG_DIR");Directory.CreateDirectory(Config);
  if(Array.IndexOf(args,"status")>=0){Console.WriteLine("{\"loggedIn\":true,\"authMethod\":\"fixture\"}");return 0;}
  if(Array.IndexOf(args,"login")>=0){Write("login.json",new {browser=Environment.GetEnvironmentVariable("BROWSER"),args=args,config=Config});Console.WriteLine("Login fixture only; no browser opened");return 0;}
  var index=Array.IndexOf(args,"--settings");if(index>=0)Settings=Json.Deserialize<Dictionary<string,object>>(args[index+1]);
  Sid=Guid.NewGuid().ToString();index=Array.IndexOf(args,"--resume");if(index>=0){Guid id;if(Guid.TryParse(args[index+1],out id))Sid=id.ToString();else{var lines=File.ReadAllLines(args[index+1]);var first=Json.Deserialize<Dictionary<string,object>>(lines[0]);if(first.ContainsKey("sessionId"))Sid=Convert.ToString(first["sessionId"]);}}
  var folder=Path.Combine(Config,"projects","windows-fixture");Directory.CreateDirectory(folder);Transcript=Path.Combine(folder,Sid+".jsonl");File.WriteAllText(Transcript,Json.Serialize(new {type="user",sessionId=Sid,message=new {role="user",content="Windows fixture session"}})+"\n",new UTF8Encoding(false));
  Write("launch.json",new {pid=Process.GetCurrentProcess().Id,config=Config,browser=Environment.GetEnvironmentVariable("BROWSER"),model=Environment.GetEnvironmentVariable("ANTHROPIC_MODEL"),token=Environment.GetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN"),apiKey=Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY"),args=args,cwd=Directory.GetCurrentDirectory()});
  Event("SessionStart");Console.WriteLine("WINDOWS_COPY_FIXTURE");Console.WriteLine("Windows Chinese fixture (12 个通过 9 个)");RunHud();
  Console.CancelKeyPress+=(sender,e)=>{e.Cancel=true;CancelCount++;Write("interrupt.json",new {count=CancelCount});};
  while(true){var line=Console.ReadLine();if(line==null){Thread.Sleep(100);continue;}if(line=="BUSY"){Event("UserPromptSubmit");Console.WriteLine("BUSY_FIXTURE");}else if(line=="STOP"){Event("Stop");Console.WriteLine("STOP_FIXTURE");}else if(line=="EXIT"){Event("SessionEnd");return 0;}else Console.WriteLine("ECHO:"+line);}
 }
}
