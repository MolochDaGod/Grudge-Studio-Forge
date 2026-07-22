namespace GameForge.Behaviours;

/// <summary>
/// WASD/arrow strafe on XZ using <see cref="Input"/> — validates SetKey → tick bridge.
/// </summary>
public sealed class StrafeBehaviour : MonoBehaviour
{
    public float Speed { get; set; } = 4f;

    public override void Update(float deltaTime)
    {
        var h = Input.Horizontal;
        var v = Input.Vertical;
        if (MathF.Abs(h) < 1e-4f && MathF.Abs(v) < 1e-4f) return;
        Transform.Translate(new Vector3(h * Speed * deltaTime, 0f, -v * Speed * deltaTime));
    }
}
