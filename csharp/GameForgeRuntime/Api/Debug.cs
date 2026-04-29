using System.Runtime.InteropServices.JavaScript;

namespace GameForge;

public static partial class Debug
{
    [JSImport("globalThis.__gameForgeLog")]
    internal static partial void JsLog(string level, string message);

    public static void Log(object? message) => JsLog("log", message?.ToString() ?? "null");
    public static void LogWarning(object? message) => JsLog("warn", message?.ToString() ?? "null");
    public static void LogError(object? message) => JsLog("error", message?.ToString() ?? "null");
    public static void LogInfo(object? message) => JsLog("info", message?.ToString() ?? "null");
}
