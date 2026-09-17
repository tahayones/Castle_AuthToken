namespace CastleApi.Models;

public class CastleTokenRequest
{
    public string? ProxyIp { get; set; }
    public int Count { get; set; } = 1;
    public int Threads { get; set; } = 1;
}
