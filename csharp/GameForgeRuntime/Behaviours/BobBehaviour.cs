namespace GameForge.Behaviours;

/// <summary>Vertical bob for props / pickups (production sample pack).</summary>
public sealed class BobBehaviour : MonoBehaviour
{
    public float Amplitude { get; set; } = 0.35f;
    public float Frequency { get; set; } = 2f;
    private float _originY;
    private bool _seeded;

    public override void Start()
    {
        _originY = Transform.Position.Y;
        _seeded = true;
    }

    public override void Update(float deltaTime)
    {
        if (!_seeded)
        {
            _originY = Transform.Position.Y;
            _seeded = true;
        }
        var y = _originY + MathF.Sin(Time.ElapsedTime * Frequency) * Amplitude;
        Transform.Position = new Vector3(Transform.Position.X, y, Transform.Position.Z);
    }
}
