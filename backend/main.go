package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"regexp"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
)

// AnalyzeRequest defines the structure of the incoming JSON request.
type AnalyzeRequest struct {
	Code string `json:"code"`
}

// AnalyzeResponse defines the structure of the JSON response.
type AnalyzeResponse struct {
	Suggestion string `json:"suggestion"`
}

// BedrockOutput is used to parse the nested 'output' from the Bedrock response.
type BedrockOutput struct {
	Output string `json:"output"`
}

// BedrockConverseAPI encapsulates the Bedrock client.
type BedrockConverseAPI struct {
	Client *bedrockruntime.Client
}

// NewBedrockConverseAPI creates a new Bedrock API client.
func NewBedrockConverseAPI(ctx context.Context, region string) (*BedrockConverseAPI, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS configuration: %w", err)
	}

	return &BedrockConverseAPI{
		Client: bedrockruntime.NewFromConfig(cfg),
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
	log.Printf("Received code: %s", cleanedCode)

	// --- Start of new logic to filter context data ---

	// 1. Extract resource types from the input code using regex.
	re := regexp.MustCompile(`resource\s+"([^"]+)"`)
	matches := re.FindAllStringSubmatch(cleanedCode, -1)
	resourceTypes := []string{}
	for _, match := range matches {
		if len(match) > 1 {
			resourceTypes = append(resourceTypes, match[1])
		}
	}
	log.Printf("Found resource types in code: %v", resourceTypes)

	// 2. Read helper documents.
	file1Bytes, err := ioutil.ReadFile("./helper/aws_security_controls.json")
	if err != nil {
		http.Error(w, "Failed to read aws_security_controls.json", http.StatusInternalServerError)
		log.Printf("Error reading file1: %v", err)
		return
	}
	var securityControls []map[string]interface{}
	json.Unmarshal(file1Bytes, &securityControls)

	file2Bytes, err := ioutil.ReadFile("./helper/terraform_registry.json")
	if err != nil {
		http.Error(w, "Failed to read terraform_registry.json", http.StatusInternalServerError)
		log.Printf("Error reading file2: %v", err)
		return
	}
	var terraformRegistry map[string]interface{}
	json.Unmarshal(file2Bytes, &terraformRegistry)

	// 3. Filter the data based on extracted resource types.
	relevantControls := []map[string]interface{}{}
	for _, control := range securityControls {
		controlStr, _ := json.Marshal(control)
		for _, resType := range resourceTypes {
			if strings.Contains(string(controlStr), resType) {
				relevantControls = append(relevantControls, control)
				break // Avoid adding the same control multiple times
			}
		}
	}

	relevantRegistryEntries := make(map[string]interface{})
	for _, resType := range resourceTypes {
		if entry, ok := terraformRegistry[resType]; ok {
			relevantRegistryEntries[resType] = entry
		}
	}

	// 4. Create the new, smaller contextData.
	relevantControlsBytes, _ := json.Marshal(relevantControls)
	relevantRegistryBytes, _ := json.Marshal(relevantRegistryEntries)
	contextData := fmt.Sprintf("Training data 1: %s\n\nTraining data 2: %s", string(relevantControlsBytes), string(relevantRegistryBytes))

	// --- End of new logic ---

	// Construct the prompt for the model
	promptTemplate := `You are a Terraform compliance analysis engine. You have been trained on internal JSON compliance documents.

Your task is to analyze the provided Terraform code, identify non-compliant patterns, and generate a JSON object containing specific code modifications to fix them.

Analysis Scope: Your analysis MUST focus exclusively on resource blocks within the Terraform code. Ignore all other block types, including provider, terraform, variable, output, and data blocks. All suggestions must pertain only to the attributes and definitions within the resource blocks.

Output Requirements:

Format: The output MUST be a single, valid JSON array of objects.

Content: Each object in the array represents a single required code change and MUST contain the following keys:

"line_number": An integer for the line in the original code where the non-compliant code begins within a resource block.

"current_code": A string containing the exact block or line(s) of code from a resource block that are non-compliant.

"suggested_code": A string containing the compliant code that should replace the current_code.

Exclusions: Do NOT include explanations, markdown formatting, or any text outside of the final JSON array.

Terraform Code to Analyze:
{code}
`
	fmt.Printf("Using prompt template: %s\n", promptTemplate)

	finalPrompt := strings.Replace(promptTemplate, "{code}", cleanedCode, 1)

	// Define the model and parameters
	modelID := "us.meta.llama3-3-70b-instruct-v1:0"
	temperature := float32(0)
	maxTokens := int32(2048)

	// Create the input for the Bedrock Converse API
	input := &bedrockruntime.ConverseInput{
		ModelId: aws.String(modelID),
		Messages: []types.Message{
			{
				Role: types.ConversationRoleUser,
				Content: []types.ContentBlock{
					&types.ContentBlockMemberDocument{
						Value: types.DocumentBlock{
							Format: types.DocumentFormatTxt,
							Name:   aws.String("context"),
							Source: &types.DocumentSourceMemberBytes{
								Value: []byte(contextData),
							},
						},
					},
					&types.ContentBlockMemberText{
						Value: finalPrompt,
					},
				},
			},
		},
		InferenceConfig: &types.InferenceConfiguration{
			Temperature: &temperature,
			MaxTokens:   &maxTokens,
		},
	}

	log.Println("Invoking Bedrock model with filtered context...")
	// Invoke the model
	output, err := api.Client.Converse(context.Background(), input)
	if err != nil {
		http.Error(w, "Model invocation failed.", http.StatusInternalServerError)
		log.Printf("Error invoking Bedrock model: %v", err)
		return
	}

	// Extract and parse the response
	var suggestion string
	if msgOutput, ok := output.Output.(*types.ConverseOutputMemberMessage); ok {
		for _, content := range msgOutput.Value.Content {
			if textBlock, ok := content.(*types.ContentBlockMemberText); ok {
				// The model's direct output might be a JSON string, which we need to parse.
				var bedrockOut BedrockOutput
				if err := json.Unmarshal([]byte(textBlock.Value), &bedrockOut); err == nil {
					suggestion = bedrockOut.Output
				} else {
					// If it's not a JSON string, use the text directly.
					suggestion = textBlock.Value
					log.Printf("Could not parse model output as JSON, using raw text. Error: %v", err)
				}
				break // Assuming we only need the first text block
			}
		}
	}

	// Send the response
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(AnalyzeResponse{Suggestion: suggestion}); err != nil {
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
