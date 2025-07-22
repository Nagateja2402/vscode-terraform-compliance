package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/bedrockagentruntime"
	"github.com/aws/aws-sdk-go-v2/service/bedrockagentruntime/types"
)

// AnalyzeRequest defines the structure of the incoming JSON request.
type AnalyzeRequest struct {
	Code string `json:"code"`
}

// AnalyzeResponse defines the structure of the JSON response.
type AnalyzeResponse struct {
	Suggestion string `json:"suggestion"`
}

// BedrockConverseAPI encapsulates the Bedrock agent client.
type BedrockConverseAPI struct {
	Client *bedrockagentruntime.Client
}

// NewBedrockConverseAPI creates a new Bedrock agent API client.
func NewBedrockConverseAPI(ctx context.Context, region string) (*BedrockConverseAPI, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS configuration: %w", err)
	}

	return &BedrockConverseAPI{
		Client: bedrockagentruntime.NewFromConfig(cfg),
	}, nil
}

// analyzeHandler handles the /analyze endpoint.
func (api *BedrockConverseAPI) analyzeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Only POST method is allowed", http.StatusMethodNotAllowed)
		return
	}

	var req AnalyzeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Code == "" {
		http.Error(w, "Query text is empty or not a string", http.StatusInternalServerError)
		return
	}

	// Clean the input code
	cleanedCode := strings.ReplaceAll(req.Code, "\n", " ")

	// --- Start of new logic to filter context data ---

	// 1. Extract resource types from the input code using regex.
	re := regexp.MustCompile(`resource\s+"([^"]+)"`)
	matches := re.FindAllStringSubmatch(cleanedCode, -1)
	resourceTypes := ""
	for _, match := range matches {
		if len(match) > 1 {
			resourceTypes += match[1] + ", "
		}
	}

	// Construct the prompt for the model
	promptTemplate := `
Your task is to analyze the provided Terraform code, identify non-compliant patterns based on the FSBP sentinel policies in the knowledge base, and generate a JSON object containing specific code modifications to fix them.

Terraform Code to Analyze:
{code}

Resource Types to Consider: {resourceTypes}

Exclusions: Do NOT include explanations, markdown formatting, or any text outside of the final JSON array.

Give utmost two suggestion per query. Don't give same suggestion twice.
`

	finalPrompt := strings.Replace(promptTemplate, "{code}", cleanedCode, 1)
	finalPrompt = strings.Replace(finalPrompt, "{resourceTypes}", resourceTypes, 1)

	// Define the model and parameters
	agentID := "CJUKDDIFLZ"
	agentAliasID := "6HDTACF2UW"

	// Create the input for the Bedrock Agent API
	input := &bedrockagentruntime.InvokeAgentInput{
		AgentId:      aws.String(agentID),
		AgentAliasId: aws.String(agentAliasID),
		InputText:    aws.String(finalPrompt),
		SessionId:    aws.String("default-session"), // You can generate a unique session ID if needed
	}

	log.Println("Invoking Bedrock agent with filtered context...")
	// Invoke the agent
	output, err := api.Client.InvokeAgent(context.Background(), input)
	if err != nil {
		http.Error(w, "Agent invocation failed.", http.StatusInternalServerError)
		log.Printf("Error invoking Bedrock agent: %v", err)
		return
	}
	// Extract and parse the response from agent
	var suggestion strings.Builder
	for event := range output.GetStream().Events() {
		switch v := event.(type) {
		case *types.ResponseStreamMemberChunk:
			if v.Value.Bytes != nil {
				suggestion.Write(v.Value.Bytes)
			}
		case *types.ResponseStreamMemberTrace:
			// Handle trace events if needed
			log.Printf("Trace event: %+v", v.Value)
		}
	}

	// Send the response
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(AnalyzeResponse{Suggestion: suggestion.String()}); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
	}
}

func main() {
	// Initialize the Bedrock client
	api, err := NewBedrockConverseAPI(context.Background(), "us-east-1")
	if err != nil {
		log.Fatalf("Failed to create Bedrock client: %v", err)
	}

	// Set up the HTTP server
	http.HandleFunc("/analyze", api.analyzeHandler)

	port := "3000"
	log.Printf("Server is listening at port %s", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
