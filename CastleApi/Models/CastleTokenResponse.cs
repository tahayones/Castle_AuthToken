namespace CastleApi.Models;

public class CastleTokenResponse
{
    public bool Success { get; set; }
    public string? Token { get; set; }
    public List<string> Tokens { get; set; } = new();
    public long ExecutionTimeMs { get; set; }
    public string? ErrorMessage { get; set; }
}
