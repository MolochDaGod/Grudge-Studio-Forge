namespace GameForge;

public static class Time
{
    public static float DeltaTime { get; internal set; } = 0f;
    public static float ElapsedTime { get; internal set; } = 0f;
    public static int FrameCount { get; internal set; } = 0;

    internal static void Tick(float dt)
    {
        DeltaTime = dt;
        ElapsedTime += dt;
        FrameCount++;
    }
}
