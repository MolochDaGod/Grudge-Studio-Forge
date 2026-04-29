namespace GameForge;

public class Transform
{
    public Vector3 Position { get; set; } = Vector3.Zero;
    public Vector3 Rotation { get; set; } = Vector3.Zero;
    public Vector3 Scale { get; set; } = Vector3.One;

    public Vector3 Forward
    {
        get
        {
            var ry = Rotation.Y * MathF.PI / 180f;
            var rx = Rotation.X * MathF.PI / 180f;
            return new Vector3(
                MathF.Sin(ry) * MathF.Cos(rx),
                -MathF.Sin(rx),
                -MathF.Cos(ry) * MathF.Cos(rx)
            ).Normalized;
        }
    }

    public Vector3 Right
    {
        get
        {
            var ry = Rotation.Y * MathF.PI / 180f;
            return new Vector3(MathF.Cos(ry), 0f, MathF.Sin(ry)).Normalized;
        }
    }

    public void Translate(Vector3 v) => Position += v;
    public void Rotate(Vector3 eulerDeg) => Rotation += eulerDeg;
}
