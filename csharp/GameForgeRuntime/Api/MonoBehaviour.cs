namespace GameForge;

public abstract class MonoBehaviour
{
    public string EntityId { get; internal set; } = "";
    public string Name { get; internal set; } = "";
    public Transform Transform { get; internal set; } = new();

    public virtual void Start() { }
    public virtual void Update(float deltaTime) { }
    public virtual void OnDestroy() { }
}
