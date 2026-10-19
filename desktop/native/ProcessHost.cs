using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

// A hidden console allows Node's SIGINT handler to flush application data.
// The Job Object also owns descendants, including LiveKit, on host failure.
internal static class ProcessHost {
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long ProcessTime, JobTime; public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet; public uint ActiveProcesses;
        public UIntPtr Affinity; public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
        public BasicLimits Basic; public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    delegate bool ControlHandler(uint signal);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int type, ref ExtendedLimits info, uint length);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll")] static extern bool AllocConsole();
    [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("kernel32.dll")] static extern bool SetConsoleCtrlHandler(ControlHandler handler, bool add);
    [DllImport("kernel32.dll")] static extern bool GenerateConsoleCtrlEvent(uint signal, uint group);
    static ControlHandler ignore = delegate(uint signal) { return signal == 0 || signal == 1; };
    static readonly object outputLock = new object();
    static int stopping;
    // ProcessStartInfo.Arguments uses the Windows argv quoting rules, not a shell.
    // Double each run of backslashes before a quote and at the closing quote.
    static string QuoteArgument(string value) {
        if(value.Length > 0 && value.IndexOfAny(new char[] { ' ', '\t', '\n', '\v', '"' }) < 0) return value;
        StringBuilder result = new StringBuilder("\"");
        int slashes = 0;
        foreach(char character in value) {
            if(character == '\\') { slashes++; continue; }
            if(character == '"') { result.Append('\\', slashes * 2 + 1); result.Append('"'); }
            else { result.Append('\\', slashes); result.Append(character); }
            slashes = 0;
        }
        result.Append('\\', slashes * 2); result.Append('"');
        return result.ToString();
    }
    static int Main(string[] args) {
        Console.OutputEncoding = new UTF8Encoding(false);
        TextReader input = Console.In;
        TextWriter output = Console.Out;
        if(args.Length < 1 || !File.Exists(args[0])) return 2;
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        ExtendedLimits limits = new ExtendedLimits(); limits.Basic.Flags = 0x2000;
        if(job == IntPtr.Zero || !SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits)) || !AssignProcessToJobObject(job, Process.GetCurrentProcess().Handle)) {
            output.WriteLine("Process supervisor could not create an owned Job Object: " + Marshal.GetLastWin32Error()); return 3;
        }
        if(GetConsoleWindow() == IntPtr.Zero) AllocConsole();
        ShowWindow(GetConsoleWindow(), 0);
        SetConsoleCtrlHandler(null, false);
        Process child = new Process();
        child.StartInfo = new ProcessStartInfo(args[0]) {
            UseShellExecute = false, CreateNoWindow = false,
            WorkingDirectory = Environment.CurrentDirectory,
            RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        };
        StringBuilder childArguments = new StringBuilder();
        for(int i = 1; i < args.Length; i++) {
            if(i > 1) childArguments.Append(' ');
            childArguments.Append(QuoteArgument(args[i]));
        }
        child.StartInfo.Arguments = childArguments.ToString();
        Action<string> print = delegate(string text) { if(text != null) lock(outputLock) { output.WriteLine(text); output.Flush(); } };
        child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { print(e.Data); };
        child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { print(e.Data); };
        try {
            child.Start(); SetConsoleCtrlHandler(ignore, true);
            print("@@ZVIEWER_PID:" + child.Id);
            child.BeginOutputReadLine(); child.BeginErrorReadLine();
            Task.Run(delegate {
                while(true) {
                    string line;
                    try { line = input.ReadLine(); } catch { line = null; }
                    if(line == "stop" || line == null) {
                        if(Interlocked.Exchange(ref stopping, 1) != 0) return;
                        print("[supervisor] Requesting a graceful shutdown");
                        GenerateConsoleCtrlEvent(0, 0);
                        if(!child.WaitForExit(12000)) {
                            print("[supervisor] Shutdown timed out; terminating the owned job");
                            TerminateJobObject(job, 1);
                        }
                        return;
                    }
                }
            });
            child.WaitForExit();
            return child.ExitCode;
        } catch(Exception error) { print("[supervisor] " + error.Message); return 4; }
    }
}
