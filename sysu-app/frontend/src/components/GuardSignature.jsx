import React from "react";
import PropTypes from "prop-types";

const GuardSignature = ({
  firstName,
  lastName,
  mi,
  signatureBase64,
  verified,
}) => {
  const name = `${firstName} ${mi ? `${mi}. ` : ""}${lastName}`.trim();
  const signatureUrl = signatureBase64
    ? `data:image/png;base64,${signatureBase64}`
    : null;

  return (
    <div className="flex items-center space-x-2">
      {signatureUrl && (
        <img
          src={signatureUrl}
          alt={`${name} signature`}
          className="h-8 w-auto border border-db-border rounded"
        />
      )}
      {verified && (
        <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded">
          Verified
        </span>
      )}
      {!signatureUrl && verified && (
        <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded">
          Verified
        </span>
      )}
    </div>
  );
};

GuardSignature.propTypes = {
  firstName: PropTypes.string.isRequired,
  lastName: PropTypes.string.isRequired,
  mi: PropTypes.string,
  signatureBase64: PropTypes.string,
  verified: PropTypes.bool,
};

GuardSignature.defaultProps = {
  mi: "",
  signatureBase64: "",
  verified: false,
};

export default GuardSignature;
