namespace GameForge.Behaviours;

/// <summary>
/// Production sample pack: spin around Y (degrees/sec). Used by hybrid
/// Blazor attach/tick path — see JS <c>@forge-pack: Spin</c>.
/// </summary>
public sealed class SpinBehaviour : MonoBehaviour
{
    public float DegreesPerSecond { get; set; } = 90f;

    public override void Update(float deltaTime)
    {
        Transform.Rotate(new Vector3(0f, DegreesPerSecond * deltaTime, 0f));
    }
}
