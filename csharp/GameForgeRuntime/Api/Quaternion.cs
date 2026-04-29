namespace GameForge;

public struct Quaternion
{
    public float X;
    public float Y;
    public float Z;
    public float W;

    public Quaternion(float x, float y, float z, float w) { X = x; Y = y; Z = z; W = w; }

    public static Quaternion Identity => new(0, 0, 0, 1);

    public static Quaternion Euler(float xDeg, float yDeg, float zDeg)
    {
        var rx = xDeg * MathF.PI / 180f;
        var ry = yDeg * MathF.PI / 180f;
        var rz = zDeg * MathF.PI / 180f;
        var cx = MathF.Cos(rx * 0.5f); var sx = MathF.Sin(rx * 0.5f);
        var cy = MathF.Cos(ry * 0.5f); var sy = MathF.Sin(ry * 0.5f);
        var cz = MathF.Cos(rz * 0.5f); var sz = MathF.Sin(rz * 0.5f);
        return new Quaternion(
            sx * cy * cz - cx * sy * sz,
            cx * sy * cz + sx * cy * sz,
            cx * cy * sz - sx * sy * cz,
            cx * cy * cz + sx * sy * sz
        );
    }

    public override string ToString() => $"({X:0.###}, {Y:0.###}, {Z:0.###}, {W:0.###})";
}
