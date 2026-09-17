namespace CastleApi.Models;

public class TwitterAuthRequest
{
    public required string Username { get; set; }
    public required string Password { get; set; }
    public string? TotpSecret { get; set; }
    public string? Proxy { get; set; }
}
