namespace GameForge;

public static class Input
{
    private static readonly HashSet<string> _keys = new();

    internal static void SetKey(string key, bool down)
    {
        if (down) _keys.Add(key);
        else _keys.Remove(key);
    }

    internal static void Reset() => _keys.Clear();

    public static bool GetKey(string key) => _keys.Contains(key);

    public static bool GetKey(string key, params string[] aliases)
    {
        if (_keys.Contains(key)) return true;
        foreach (var a in aliases) if (_keys.Contains(a)) return true;
        return false;
    }

    public static float Horizontal =>
        (GetKey("ArrowRight") || GetKey("d") || GetKey("D") ? 1f : 0f) -
        (GetKey("ArrowLeft") || GetKey("a") || GetKey("A") ? 1f : 0f);

    public static float Vertical =>
        (GetKey("ArrowUp") || GetKey("w") || GetKey("W") ? 1f : 0f) -
        (GetKey("ArrowDown") || GetKey("s") || GetKey("S") ? 1f : 0f);
}
