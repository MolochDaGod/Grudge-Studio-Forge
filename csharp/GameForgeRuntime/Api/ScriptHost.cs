using System.Reflection;
using System.Runtime.InteropServices.JavaScript;
using System.Text.Json;

namespace GameForge;

public static partial class ScriptHost
{
    private static readonly Dictionary<string, MonoBehaviour> _instances = new();
    private static readonly Dictionary<string, Type> _scriptTypes = new();

    [JSExport]
    public static string Boot()
    {
        return $"GameForge .NET runtime ready (.NET {Environment.Version})";
    }

    [JSExport]
    public static bool RegisterScriptType(string scriptName, string assemblyBase64)
    {
        try
        {
            var bytes = Convert.FromBase64String(assemblyBase64);
            var asm = Assembly.Load(bytes);
            var type = asm.GetTypes().FirstOrDefault(t => typeof(MonoBehaviour).IsAssignableFrom(t) && !t.IsAbstract);
            if (type == null)
            {
                Debug.LogError($"No MonoBehaviour found in script '{scriptName}'.");
                return false;
            }
            _scriptTypes[scriptName] = type;
            return true;
        }
        catch (Exception ex)
        {
            Debug.LogError($"Failed to register script '{scriptName}': {ex.Message}");
            return false;
        }
    }

    [JSExport]
    public static bool AttachScript(string entityId, string entityName, string scriptName, string transformJson)
    {
        if (!_scriptTypes.TryGetValue(scriptName, out var type))
        {
            Debug.LogError($"Script '{scriptName}' not registered.");
            return false;
        }
        try
        {
            var instance = (MonoBehaviour)Activator.CreateInstance(type)!;
            instance.EntityId = entityId;
            instance.Name = entityName;
            instance.Transform = ParseTransform(transformJson);
            _instances[entityId] = instance;
            instance.Start();
            return true;
        }
        catch (Exception ex)
        {
            Debug.LogError($"Failed to attach '{scriptName}' to '{entityName}': {ex.Message}");
            return false;
        }
    }

    [JSExport]
    public static string TickEntity(string entityId, float deltaTime, string transformJson)
    {
        if (!_instances.TryGetValue(entityId, out var inst)) return transformJson;
        try
        {
            inst.Transform = ParseTransform(transformJson);
            Time.Tick(deltaTime);
            inst.Update(deltaTime);
            return SerializeTransform(inst.Transform);
        }
        catch (Exception ex)
        {
            Debug.LogError($"Update error on '{inst.Name}': {ex.Message}");
            return transformJson;
        }
    }

    [JSExport]
    public static void DetachEntity(string entityId)
    {
        if (_instances.TryGetValue(entityId, out var inst))
        {
            try { inst.OnDestroy(); } catch { }
            _instances.Remove(entityId);
        }
    }

    [JSExport]
    public static void ClearAll()
    {
        foreach (var inst in _instances.Values)
        {
            try { inst.OnDestroy(); } catch { }
        }
        _instances.Clear();
        Input.Reset();
        Time.ElapsedTime = 0f;
        Time.FrameCount = 0;
    }

    [JSExport]
    public static void SetKey(string key, bool down) => Input.SetKey(key, down);

    private static Transform ParseTransform(string json)
    {
        var t = new Transform();
        if (string.IsNullOrEmpty(json)) return t;
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        if (root.TryGetProperty("position", out var p) && p.GetArrayLength() == 3)
            t.Position = new Vector3(p[0].GetSingle(), p[1].GetSingle(), p[2].GetSingle());
        if (root.TryGetProperty("rotation", out var r) && r.GetArrayLength() == 3)
            t.Rotation = new Vector3(r[0].GetSingle(), r[1].GetSingle(), r[2].GetSingle());
        if (root.TryGetProperty("scale", out var s) && s.GetArrayLength() == 3)
            t.Scale = new Vector3(s[0].GetSingle(), s[1].GetSingle(), s[2].GetSingle());
        return t;
    }

    private static string SerializeTransform(Transform t) =>
        $"{{\"position\":[{t.Position.X},{t.Position.Y},{t.Position.Z}]," +
        $"\"rotation\":[{t.Rotation.X},{t.Rotation.Y},{t.Rotation.Z}]," +
        $"\"scale\":[{t.Scale.X},{t.Scale.Y},{t.Scale.Z}]}}";
}
