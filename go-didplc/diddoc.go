package didplc

import ()

type DocVerificationMethod struct {
	ID                 string `json:"id"`
	Type               string `json:"type"`
	Controller         string `json:"controller"`
	PublicKeyMultibase string `json:"publicKeyMultibase"`
}

type DocService struct {
	ID              string `json:"id"`
	Type            string `json:"type"`
	ServiceEndpoint string `json:"serviceEndpoint"`
}

type Doc struct {
	ID                  string                  `json:"id"`
	AlsoKnownAs         []string                `json:"alsoKnownAs,omitempty"`
	VerificationMethods []DocVerificationMethod `json:"verificationMethods,omitempty"`
	Service             []DocService            `json:"service,omitempty"`
}
