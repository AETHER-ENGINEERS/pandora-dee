// Pandora Dee's home host: one resident as her own Windows service.
// Windows starts a service only through a program that answers it; this small one does, and runs her own process
// (node host/resident_main.cjs) under the service's own identity (NT SERVICE\<name>), starting it again if it stops.
// It is compiled on the computer itself, by the install step, with the .NET compiler Windows already has (2.0 or
// later), so nothing is downloaded. Written for C# 2, so it builds on old Windows too.
//   pdee-service.exe <service name> <node.exe> <resident_main.cjs> <resident.json>
using System;
using System.Diagnostics;
using System.ServiceProcess;
using System.Threading;

class PdeeService : ServiceBase
{
    string node, main, config;
    Process child;
    volatile bool stopping;
    Thread watcher;

    static void Main(string[] args)
    {
        if (args.Length < 4) { Console.Error.WriteLine("pdee-service <name> <node> <resident_main.cjs> <resident.json>"); return; }
        ServiceBase.Run(new PdeeService(args));
    }

    PdeeService(string[] args)
    {
        ServiceName = args[0]; node = args[1]; main = args[2]; config = args[3];
        CanStop = true; CanShutdown = true; AutoLog = true;
    }

    static string Quote(string s) { return "\"" + s.Replace("\"", "\\\"") + "\""; }

    void Watch()
    {
        int wait = 1000;
        while (!stopping)
        {
            DateTime began = DateTime.UtcNow;
            try
            {
                ProcessStartInfo si = new ProcessStartInfo(node, Quote(main) + " --config " + Quote(config) + " --stdin-stop");
                si.UseShellExecute = false; si.CreateNoWindow = true;
                si.RedirectStandardInput = true; si.RedirectStandardOutput = true; si.RedirectStandardError = true;
                child = Process.Start(si);
                child.OutputDataReceived += new DataReceivedEventHandler(Ignore);
                child.ErrorDataReceived += new DataReceivedEventHandler(Ignore);
                child.BeginOutputReadLine(); child.BeginErrorReadLine();
                child.WaitForExit();
            }
            catch (Exception) { /* node missing or not readable by her identity: wait and try again */ }
            if (stopping) break;
            wait = (DateTime.UtcNow - began).TotalSeconds > 60 ? 1000 : Math.Min(wait * 2, 60000);
            for (int i = 0; i < wait / 250 && !stopping; i++) Thread.Sleep(250);
        }
    }
    static void Ignore(object sender, DataReceivedEventArgs e) { }

    protected override void OnStart(string[] args)
    {
        stopping = false;
        watcher = new Thread(new ThreadStart(Watch));
        watcher.IsBackground = true;
        watcher.Start();
    }

    void StopChild()
    {
        stopping = true;
        Process c = child;
        if (c == null) return;
        try
        {
            if (!c.HasExited)
            {
                RequestAdditionalTime(12000);
                c.StandardInput.Close(); // she finishes writing, then stops
                if (!c.WaitForExit(10000)) c.Kill();
            }
        }
        catch (Exception) { try { c.Kill(); } catch (Exception) { } }
    }

    protected override void OnStop() { StopChild(); }
    protected override void OnShutdown() { StopChild(); }
}
