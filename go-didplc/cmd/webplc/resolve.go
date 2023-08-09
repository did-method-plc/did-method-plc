
package main

import (
	"io"
	"fmt"
	"net/http"
	"encoding/json"
)

type VerificationMethod struct {
	Id string `json:"id"`
	Type string `json:"type"`
	Controller string `json:"controller"`
	PublicKeyMultibase string `json:"publicKeyMultibase"`
}

type DidService struct {
	Id string `json:"id"`
	Type string `json:"type"`
	ServiceEndpoint string `json:"serviceEndpoint"`
}

type DidDoc struct {
	AlsoKnownAs []string `json:"alsoKnownAs"`
	VerificationMethod []VerificationMethod `json:"verificationMethod"`
	Service []DidService `json:"service"`
}

type ResolutionResult struct {
	Doc *DidDoc
	DocJson *string
	StatusCode int
}

func ResolveDidPlc(client *http.Client, plc_host, did string) (*ResolutionResult, error) {
	result := ResolutionResult{}
	res, err := client.Get(fmt.Sprintf("%s/%s", plc_host, did))
	if err != nil {
		return nil, fmt.Errorf("error making http request: %v", err)
	}
	defer res.Body.Close()
	log.Debugf("PLC resolution result status=%d did=%s", res.StatusCode, did)

	result.StatusCode = res.StatusCode
	if res.StatusCode == 404 {
		return nil, fmt.Errorf("DID not found in PLC directory: %s", did)
	} else if res.StatusCode != 200 {
		return &result, nil
	}

	respBytes, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read PLC result body: %v", err)
	}

	doc := DidDoc{}
	err = json.Unmarshal(respBytes, &doc)
	if err != nil {
		return nil, fmt.Errorf("failed to parse DID Document JSON:", err)
	}
	result.Doc = &doc

	// parse and re-serialize JSON in pretty (indent) style
	var data map[string]interface{}
	err = json.Unmarshal(respBytes, &data)
	if err != nil {
		return nil, fmt.Errorf("failed to parse DID Document JSON:", err)
	}
	indentJson, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to parse DID Document JSON:", err)
	}
	s := string(indentJson)
	result.DocJson = &s

	return &result, nil
}
